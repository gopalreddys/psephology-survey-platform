import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as policy from "./operational-lifecycle-policy.js";

// Optional isolated PostgreSQL implementation, never a configured API/RDS
// connection. Set PGLITE_MODULE_PATH to an installed @electric-sql/pglite module.
const pgliteModule = process.env.PGLITE_MODULE_PATH
  ? pathToFileURL(process.env.PGLITE_MODULE_PATH).href : "@electric-sql/pglite";
const { PGlite } = await import(pgliteModule);
const pg = new PGlite();
const queries = [];
const db = {
  async query(sql, values = []) {
    queries.push(sql);
    // PGlite is single-session. These tests validate SQL/results and atomic
    // rollback, not actual multi-client advisory-lock concurrency.
    if (sql.includes("pg_advisory_xact_lock")) return { rows: [], rowCount: 1 };
    const result = await pg.query(sql, values);
    return { ...result, rowCount: result.rows.length || result.affectedRows || 0 };
  },
  async connect() { return db; },
  release() {}
};
let moduleNumber = 0;
async function load(relative, bindings) {
  const source = await readFile(new URL(relative, import.meta.url), "utf8");
  const key = `__operationalLifecycleFixture${moduleNumber++}`;
  globalThis[key] = bindings;
  try {
    const executable = `const { ${Object.keys(bindings).join(", ")} } = globalThis[${JSON.stringify(key)}];\n`
      + source.replace(/^import\s[\s\S]*?;\n/gm, "");
    return await import(`data:text/javascript;base64,${Buffer.from(executable).toString("base64")}`);
  } finally { delete globalThis[key]; }
}

const ids = {
  campaign: "00000000-0000-4000-8000-000000000001",
  iteration: "00000000-0000-4000-8000-000000000002",
  manager: "00000000-0000-4000-8000-000000000003",
  other: "00000000-0000-4000-8000-000000000004",
  run1: "00000000-0000-4000-8000-000000000011",
  run2: "00000000-0000-4000-8000-000000000012",
  run3: "00000000-0000-4000-8000-000000000013",
  voter: "00000000-0000-4000-8000-000000000021"
};
const manager = { id: ids.manager, role_code: "CAMPAIGN_MANAGER" };
const audit = await load("../campaign-lifecycle-governance/lifecycle-audit.repository.js", {});
const lifecycle = await load("./run-lifecycle.repository.js", {
  getDb: async () => db, assertRunAccess: async () => ({}),
  recordLifecycleEvent: audit.recordLifecycleEvent, ...policy
});
const closeout = await load("../iteration-closeout/iteration-closeout.repository.js", {
  getDb: async () => db,
  assertIterationAccess: async () => ({ id: ids.iteration, campaign_id: ids.campaign,
    campaign_manager_user_id: ids.manager }),
  ...lifecycle, ...policy
});

async function reset({ runs = 3, iterationStatus = "ACTIVE", linkStatus = "ACTIVE" } = {}) {
  await pg.exec(`TRUNCATE campaign_runs, program_iterations, campaign_iteration_links,
    campaigns, campaign_run_contacts, campaign_run_cycles, call_executions, calls,
    operational_lifecycle_events;`);
  await db.query("INSERT INTO campaigns(id, campaign_name, campaign_manager_user_id) VALUES ($1, 'Test campaign', $2)", [ids.campaign, ids.manager]);
  await db.query("INSERT INTO program_iterations(id, iteration_number, iteration_name, status, updated_at) VALUES ($1, 1, 'Test iteration', $2, now())", [ids.iteration, iterationStatus]);
  await db.query("INSERT INTO campaign_iteration_links VALUES ($1, $2, $3, now())", [ids.iteration, ids.campaign, linkStatus]);
  for (let n = 1; n <= runs; n += 1) {
    await db.query("INSERT INTO campaign_runs VALUES ($1, $2, $3, $4, 'COMPLETED', now(), now())", [ids[`run${n}`], ids.iteration, n, `Run ${n}`]);
  }
}

try {
  await pg.exec(`
    CREATE TABLE campaigns (id uuid PRIMARY KEY, campaign_name text, campaign_manager_user_id uuid);
    CREATE TABLE program_iterations (id uuid PRIMARY KEY, iteration_number int, iteration_name text, status text, updated_at timestamptz);
    CREATE TABLE campaign_iteration_links (iteration_id uuid PRIMARY KEY, campaign_id uuid, status text, updated_at timestamptz);
    CREATE TABLE campaign_runs (id uuid PRIMARY KEY, iteration_id uuid, run_number int, run_name text, status text, created_at timestamptz, updated_at timestamptz);
    CREATE TABLE campaign_run_contacts (id uuid DEFAULT gen_random_uuid(), run_id uuid, voter_id uuid,
      selection_status text DEFAULT 'SELECTED', attempt_status text, final_status text,
      retry_eligible boolean DEFAULT false, retry_exhausted boolean DEFAULT false, completion_reason text);
    CREATE TABLE campaign_run_cycles (run_id uuid, status text);
    CREATE TABLE call_executions (id uuid DEFAULT gen_random_uuid(), run_id uuid, status text, callback_received_at timestamptz);
    CREATE TABLE calls (run_id uuid, iteration_id uuid, interaction_transcript jsonb);
    CREATE TABLE operational_lifecycle_events (id uuid DEFAULT gen_random_uuid(), entity_type text,
      entity_id uuid, parent_entity_id uuid, previous_status text, next_status text,
      trigger_source text, actor_user_id uuid, details jsonb);
  `);
  for (const runs of [1, 2]) {
    await reset({ runs });
    const preview = await closeout.getIterationCloseout(ids.iteration, manager);
    assert.equal(preview.readyToComplete, false, `${runs} terminal Run(s) cannot complete an iteration`);
    await assert.rejects(closeout.completeIteration(ids.iteration, manager), (error) => error.statusCode === 409);
    assert.equal((await db.query("SELECT COUNT(*)::int AS count FROM operational_lifecycle_events")).rows[0].count, 0);
    assert.equal((await db.query("SELECT status FROM program_iterations")).rows[0].status, "ACTIVE");
  }
  await reset();
  await db.query("UPDATE campaign_runs SET status = 'RUNNING' WHERE id = $1", [ids.run3]);
  assert.equal((await closeout.getIterationCloseout(ids.iteration, manager)).readyToComplete, false);
  await reset();
  // Completed Runs cannot conceal active executions, even if a callback timestamp exists.
  await db.query("INSERT INTO call_executions(run_id, status, callback_received_at) VALUES ($1, 'SUBMITTED', now())", [ids.run1]);
  await assert.rejects(closeout.completeIteration(ids.iteration, manager), (error) => error.statusCode === 409);
  await reset();
  await db.query("INSERT INTO campaign_run_contacts(run_id, voter_id, attempt_status, final_status) VALUES ($1, $2, 'PENDING', 'SUCCESS_COMPLETE')", [ids.run1, ids.voter]);
  assert.equal((await closeout.getIterationCloseout(ids.iteration, manager)).readyToComplete, false,
    "Final outcome alone cannot substitute for the terminal attempt predicate");
  await reset();
  await db.query("INSERT INTO campaign_run_contacts(run_id, voter_id, attempt_status, final_status, retry_eligible) VALUES ($1, $2, 'FAILED', 'PENDING', true)", [ids.run3, ids.voter]);
  assert.equal((await closeout.getIterationCloseout(ids.iteration, manager)).readyToComplete, true);
  for (const role_code of ["SUPER_ADMIN", "ADMIN", "CAMPAIGNER"]) {
    await assert.rejects(closeout.completeIteration(ids.iteration, { ...manager, role_code }), (error) => error.statusCode === 403);
  }
  await assert.rejects(closeout.completeIteration(ids.iteration, { ...manager, id: ids.other }), (error) => error.statusCode === 403);
  await db.query("UPDATE campaigns SET campaign_manager_user_id = $1", [ids.other]);
  await assert.rejects(closeout.completeIteration(ids.iteration, manager), (error) => error.statusCode === 403,
    "The transaction revalidates assignment rather than relying on prior scope resolution");
  await db.query("UPDATE campaigns SET campaign_manager_user_id = $1", [ids.manager]);
  const completed = await closeout.completeIteration(ids.iteration, manager);
  assert.equal(completed.iteration.status, "COMPLETED");
  assert.equal((await db.query("SELECT status FROM program_iterations")).rows[0].status, "COMPLETED");
  const contact = (await db.query("SELECT retry_eligible, retry_exhausted, final_status FROM campaign_run_contacts")).rows[0];
  assert.deepEqual(contact, { retry_eligible: false, retry_exhausted: true, final_status: "RETRY_EXHAUSTED" });
  let events = (await db.query("SELECT * FROM operational_lifecycle_events")).rows;
  assert.equal(events.length, 1);
  assert.equal(events[0].trigger_source, "MANUAL_ITERATION_COMPLETION");
  assert.equal(events[0].actor_user_id, ids.manager);
  await closeout.completeIteration(ids.iteration, manager);
  assert.equal((await db.query("SELECT COUNT(*)::int AS count FROM operational_lifecycle_events")).rows[0].count, 1,
    "Idempotent completion does not manufacture another audit event");
  await reset();
  await db.query("INSERT INTO campaign_run_contacts(run_id, voter_id, attempt_status, final_status, retry_eligible) VALUES ($1, $2, 'FAILED', 'PENDING', true)", [ids.run3, ids.voter]);
  const brokenAuditLifecycle = await load("./run-lifecycle.repository.js", {
    getDb: async () => db, assertRunAccess: async () => ({}), ...policy,
    recordLifecycleEvent: async () => { throw new Error("Synthetic audit write failure"); }
  });
  const brokenAuditCloseout = await load("../iteration-closeout/iteration-closeout.repository.js", {
    getDb: async () => db, assertIterationAccess: async () => ({ id: ids.iteration,
      campaign_id: ids.campaign, campaign_manager_user_id: ids.manager }),
    ...brokenAuditLifecycle, ...policy
  });
  await assert.rejects(brokenAuditCloseout.completeIteration(ids.iteration, manager), /Synthetic audit write failure/);
  assert.equal((await db.query("SELECT status FROM program_iterations")).rows[0].status, "ACTIVE");
  assert.equal((await db.query("SELECT status FROM campaign_iteration_links")).rows[0].status, "ACTIVE");
  assert.deepEqual((await db.query("SELECT retry_eligible, retry_exhausted, final_status FROM campaign_run_contacts")).rows[0],
    { retry_eligible: true, retry_exhausted: false, final_status: "PENDING" },
    "Audit failure rolls back status and retry changes atomically");
  for (const iterationStatus of ["LOCKED", "ARCHIVED", "CANCELLED"]) {
    await reset({ iterationStatus });
    await assert.rejects(closeout.completeIteration(ids.iteration, manager), (error) => error.statusCode === 409);
  }
  await reset();
  await db.query("UPDATE campaign_runs SET status = CASE run_number WHEN 2 THEN 'CANCELLED' WHEN 3 THEN 'ARCHIVED' ELSE status END");
  assert.equal((await closeout.getIterationCloseout(ids.iteration, manager)).readyToComplete, true,
    "Existing closed retry-policy states remain compatible without extra calls");
  await reset();
  await db.query("UPDATE campaign_runs SET status = 'RUNNING' WHERE id = $1", [ids.run3]);
  await db.query("INSERT INTO campaign_run_contacts(run_id, voter_id, attempt_status, final_status) VALUES ($1, $2, 'COMPLETED', 'SUCCESS_COMPLETE')", [ids.run3, ids.voter]);
  await db.query("INSERT INTO campaign_run_cycles VALUES ($1, 'RUNNING')", [ids.run3]);
  await db.query("BEGIN");
  const reconciled = await lifecycle.reconcileRunLifecycle(db, ids.run3, { source: "TEST_CALLBACK" });
  assert.equal(reconciled.runFinalized, true);
  assert.equal(reconciled.iterationFinalized, true);
  await db.query("COMMIT");
  events = (await db.query("SELECT * FROM operational_lifecycle_events")).rows;
  assert.deepEqual(events.map((event) => event.entity_type).sort(), ["ITERATION", "RUN"]);
  assert.equal((await db.query("SELECT status FROM campaign_run_cycles")).rows[0].status, "COMPLETED");

  await pg.exec(`
    CREATE TABLE users(id uuid PRIMARY KEY, full_name text);
    ALTER TABLE campaigns ADD COLUMN program_id uuid, ADD COLUMN status text DEFAULT 'ACTIVE',
      ADD COLUMN created_by_user_id uuid, ADD COLUMN updated_at timestamptz DEFAULT now();
    ALTER TABLE operational_lifecycle_events ADD COLUMN created_at timestamptz DEFAULT now();
  `);
  await db.query("INSERT INTO users VALUES ($1, 'Test manager'), ($2, 'Other manager')", [ids.manager, ids.other]);
  const campaignLifecycle = await load("../campaign-lifecycle-governance/campaign-lifecycle.repository.js", {
    getDb: async () => db,
    canReviewCampaign: (campaign, actor) => campaign.campaign_manager_user_id === actor.id || actor.role_code === "SUPER_ADMIN",
    recordLifecycleEvent: audit.recordLifecycleEvent, ...policy
  });
  for (const runs of [1, 2, 3]) {
    await reset({ runs, iterationStatus: "COMPLETED", linkStatus: "COMPLETED" });
    const campaignState = await campaignLifecycle.getCampaignLifecycle(ids.campaign, manager);
    assert.equal(campaignState.readyToComplete, runs === 3);
    if (runs < 3) await assert.rejects(campaignLifecycle.completeCampaign(ids.campaign, manager), (error) => error.statusCode === 409);
  }
  await db.query("INSERT INTO campaign_runs VALUES ($1, $2, 4, 'Invalid extra Run', 'COMPLETED', now(), now())", [ids.other, ids.iteration]);
  assert.equal((await campaignLifecycle.getCampaignLifecycle(ids.campaign, manager)).readyToComplete, false);
  await reset({ iterationStatus: "COMPLETED", linkStatus: "COMPLETED" });
  await db.query("INSERT INTO campaign_run_contacts(run_id, voter_id, attempt_status, final_status) VALUES ($1, $2, 'PENDING', 'PENDING'), ($3, $2, 'COMPLETED', 'SUCCESS_COMPLETE')", [ids.run1, ids.voter, ids.run3]);
  assert.equal((await campaignLifecycle.getCampaignLifecycle(ids.campaign, manager)).readyToComplete, false,
    "A later resolved contact must not conceal an older pending attempt");
  await reset({ iterationStatus: "ACTIVE", linkStatus: "COMPLETED" });
  assert.equal((await campaignLifecycle.getCampaignLifecycle(ids.campaign, manager)).readyToComplete, false,
    "Both Iteration status tables must agree on operational closure");
  await reset({ iterationStatus: "COMPLETED", linkStatus: "COMPLETED" });
  const completedCampaign = await campaignLifecycle.completeCampaign(ids.campaign, manager);
  assert.equal(completedCampaign.campaign.status, "COMPLETED");
  await campaignLifecycle.completeCampaign(ids.campaign, manager);
  assert.equal((await db.query("SELECT COUNT(*)::int AS count FROM operational_lifecycle_events WHERE entity_type = 'CAMPAIGN'")).rows[0].count, 1);

  // Exercise the exact deployment proof and lifecycle-drift SQL, not merely
  // mocked query text. Everything remains inside this synthetic database.
  await pg.exec(`
    ALTER TABLE program_iterations ADD COLUMN voice_agent_snapshot jsonb DEFAULT '{}',
      ADD COLUMN voice_agent_id uuid, ADD COLUMN questionnaire_id uuid;
    ALTER TABLE call_executions ADD COLUMN provider_attempt_id text, ADD COLUMN run_contact_id uuid,
      ADD COLUMN error_message text, ADD COLUMN submitted_at timestamptz,
      ADD COLUMN created_at timestamptz DEFAULT now(), ADD COLUMN updated_at timestamptz DEFAULT now(),
      ADD COLUMN request_payload jsonb DEFAULT '{}';
    ALTER TABLE calls ADD COLUMN attempt_id text, ADD COLUMN connectivity_status text,
      ADD COLUMN response_variables jsonb DEFAULT '{}', ADD COLUMN normalized_status text,
      ADD COLUMN duration_seconds int, ADD COLUMN updated_at timestamptz DEFAULT now(), ADD COLUMN failure_reason text;
    CREATE TABLE sarvam_voice_agents(is_enabled boolean, app_id text, app_version int, connection_id text, outbound_phone_number text);
    CREATE TABLE sarvam_outbound_webhook_events(id uuid DEFAULT gen_random_uuid(), attempt_id text,
      delivery_status text, error_message text, received_at timestamptz, processed_at timestamptz);
    INSERT INTO sarvam_voice_agents VALUES (true, 'TEST_APP', 6, 'TEST_CONNECTION', 'TEST_ONLY_NOT_A_PHONE');
  `);
  const pipeline = await load("../pipeline-operations/pipeline.repository.js", {
    getDb: async () => db, execFile, promisify, ...policy
  });
  await reset();
  const selected = { app_id: "TEST_APP", app_version: 6, connection_id: "TEST_CONNECTION", outbound_phone_number: "TEST_ONLY_NOT_A_PHONE" };
  await db.query("UPDATE program_iterations SET voice_agent_snapshot = $1::jsonb, voice_agent_id = $2, questionnaire_id = $2", [JSON.stringify(selected), ids.other]);
  await db.query("INSERT INTO call_executions(run_id, status, provider_attempt_id, callback_received_at, request_payload) VALUES ($1, 'COMPLETED', 'TEST_ATTEMPT', now(), $2::jsonb)", [ids.run1, JSON.stringify({ providerDeployment: { ...selected, app_version: 5 } })]);
  await db.query("INSERT INTO calls(run_id, iteration_id, attempt_id, connectivity_status, normalized_status, response_variables, interaction_transcript) VALUES ($1, $2, 'TEST_ATTEMPT', 'connected', 'COMPLETED', '{\"issue\":\"Test answer\"}', $3::jsonb)", [ids.run1, ids.iteration, JSON.stringify([
    { role: "agent", text: "Hello, can we speak briefly?" }, { role: "user", text: "Yes" },
    { role: "agent", text: "Which public issue matters most?" }, { role: "user", text: "Education" }
  ])]);
  const timer = { status: "waiting", lastResult: "success" };
  let overview = await pipeline.getPipelineOverview({ db });
  assert.equal(overview.latestConversation.app_version, 5);
  assert.equal(overview.deploymentCanaries[0].execution_id, null,
    "A recent global v5 call must not become proof for selected v6");
  assert.equal(pipeline.evaluatePlatformHealth({ overview, timer }).checks.find((item) => item.id === "conversation-canary").status, "FAIL");
  await db.query("UPDATE call_executions SET request_payload = $1::jsonb", [JSON.stringify({ providerDeployment: selected })]);
  overview = await pipeline.getPipelineOverview({ db });
  assert.equal(overview.deploymentCanaries[0].proof_app_version, "6");
  assert.equal("interaction_transcript" in overview.deploymentCanaries[0], false);
  assert.equal(pipeline.evaluatePlatformHealth({ overview, timer }).status, "READY");
  await db.query("UPDATE campaign_runs SET status = 'RUNNING' WHERE id = $1", [ids.run3]);
  await db.query("INSERT INTO campaign_run_contacts(run_id, voter_id, attempt_status, final_status) VALUES ($1, $2, 'FAILED', 'PENDING')", [ids.run3, ids.voter]);
  overview = await pipeline.getPipelineOverview({ db });
  assert.equal(overview.issueTrace.runtime.incidents.some((item) => item.code === "RUN_LIFECYCLE_DRIFT"), true,
    "FAILED attempt is terminal even when final outcome remains PENDING");
  assert.equal(pipeline.evaluatePlatformHealth({ overview, timer }).status, "READY_WITH_WARNINGS");
  console.log("Isolated PostgreSQL lifecycle, closeout authorization, audit and idempotency tests passed.");
} finally {
  await pg.close();
}
