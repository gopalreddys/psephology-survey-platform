import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  CLOSED_RUN_STATUSES, terminalAttemptSql, activeExecutionSql,
  evaluateIterationLifecycle, evaluateRunLifecycle, sameDeployment
} from "./operational-lifecycle-policy.js";

const ready = { total_runs: 3, closed_policy_runs: 3, open_runs: 0,
  pending_contacts: 0, active_executions: 0 };
assert.equal(evaluateIterationLifecycle(ready).readyToComplete, true);
assert.equal(evaluateIterationLifecycle({ ...ready, total_runs: "3" }).readyToComplete, true);
for (const state of [
  { ...ready, total_runs: 1, closed_policy_runs: 1 },
  { ...ready, total_runs: 2, closed_policy_runs: 2 },
  { ...ready, total_runs: 4 }, { ...ready, closed_policy_runs: 2 },
  { ...ready, open_runs: 1 }, { ...ready, pending_contacts: 1 },
  { ...ready, active_executions: 1 }, {},
  { ...ready, pending_contacts: null }, { ...ready, active_executions: "" },
  { ...ready, total_runs: -1 }, { ...ready, total_runs: 3.5 },
  { ...ready, pending_contacts: false }, { ...ready, active_executions: " " }
]) assert.equal(evaluateIterationLifecycle(state).readyToComplete, false);
assert.deepEqual(CLOSED_RUN_STATUSES, ["COMPLETED", "FAILED", "CANCELLED", "ARCHIVED"]);
assert.equal(evaluateRunLifecycle({ total_contacts: 1, pending_contacts: 0, active_executions: 0 }), true);
assert.equal(evaluateRunLifecycle({ total_contacts: 1, active_executions: 0 }), false);
assert.equal(evaluateRunLifecycle({ total_contacts: 0, pending_contacts: 0, active_executions: 0 }), false);
assert.equal(evaluateRunLifecycle({ total_contacts: 1, pending_contacts: 0, active_executions: 1 }), false);
assert.match(terminalAttemptSql(), /'COMPLETED', 'FAILED'/);
assert.match(activeExecutionSql("active.status"), /active.status.*'COMPLETED', 'FAILED', 'CANCELLED'/);
assert.throws(() => terminalAttemptSql("contact.status); DROP TABLE users;"));
const identity = { app_id: "TEST_APP", app_version: 5, connection_id: "TEST_CONNECTION" };
assert.equal(sameDeployment(identity, { ...identity, app_version: "5" }), true);
assert.equal(sameDeployment(identity, { ...identity, app_version: 6 }), false);
assert.equal(sameDeployment(identity, { ...identity, connection_id: "OTHER" }), false);
assert.equal(sameDeployment(identity, { ...identity, app_version: null }), false);

// Execute the generic repository with isolated fixture dependencies. Completion
// is rejected before any database mutation, including through the old PATCH.
const genericSource = await readFile(new URL("../campaign-workspace/campaign-iterations.repository.js", import.meta.url), "utf8");
const genericExecutable = genericSource.replace(/^import\s[\s\S]*?;\n/gm, "");
let databaseCalls = 0;
globalThis.__lifecycleGenericBindings = { getDb: async () => {
  databaseCalls += 1;
  throw new Error("Completion must not reach the generic database path");
} };
try {
  const generic = await import(`data:text/javascript;base64,${Buffer.from(
    "const { getDb } = globalThis.__lifecycleGenericBindings;\n" + genericExecutable
  ).toString("base64")}`);
  for (const role_code of ["SUPER_ADMIN", "ADMIN", "CAMPAIGN_MANAGER", "CAMPAIGNER"]) {
    await assert.rejects(generic.updateCampaignIterationStatus("campaign", "iteration", "COMPLETED", {
      id: "actor", role_code
    }), (error) => error.statusCode === (role_code === "CAMPAIGNER" ? 403 : 409));
  }
  assert.equal(databaseCalls, 0);
} finally {
  delete globalThis.__lifecycleGenericBindings;
}

const deprecated = await readFile(new URL("../sarvam-outbound-webhook/finalize-resolved-runs.js", import.meta.url), "utf8");
assert.match(deprecated, /await import\("\.\/reconcile-open-runs.js"\)/);
assert.doesNotMatch(deprecated, /UPDATE campaign_runs|UPDATE program_iterations|UPDATE campaign_iteration_links/);
const canonicalCommand = await readFile(new URL("./reconcile-open-runs.js", import.meta.url), "utf8");
assert.match(canonicalCommand, /if \(!apply\)/);
assert.match(canonicalCommand, /finally[\s\S]*db.release\(\)[\s\S]*await pool.end\(\)/);
assert.doesNotMatch(canonicalCommand, /process.exit\(0\)/);
for (const apply of [false, true]) {
  const statements = [];
  let reconciliations = 0, releases = 0, poolCloses = 0;
  const fixtureDb = { query: async (sql) => {
    statements.push(sql);
    return { rows: sql.includes("FROM campaign_runs run") ? [{ id: "TEST_RUN" }] : [] };
  }, release: () => { releases += 1; } };
  const pool = { connect: async () => fixtureDb, end: async () => { poolCloses += 1; } };
  const key = `__lifecycleCommandFixture${apply}`;
  globalThis[key] = { getDb: async () => pool, terminalAttemptSql, activeExecutionSql,
    reconcileRunLifecycle: async () => { reconciliations += 1; return { runStatus: "COMPLETED" }; } };
  const argvBefore = process.argv;
  process.argv = [process.execPath, "synthetic-reconciler", ...(apply ? ["--apply"] : [])];
  try {
    await import(`data:text/javascript;base64,${Buffer.from(
      `const { getDb, terminalAttemptSql, activeExecutionSql, reconcileRunLifecycle } = globalThis[${JSON.stringify(key)}];\n`
      + canonicalCommand.replace(/^import\s[\s\S]*?;\n/gm, "")
    ).toString("base64")}`);
  } finally {
    process.argv = argvBefore;
    delete globalThis[key];
  }
  assert.equal(reconciliations, apply ? 1 : 0);
  assert.equal(statements.some((sql) => sql === "BEGIN"), apply);
  assert.equal(releases, 1);
  assert.equal(poolCloses, 1, "Both dry run and apply close the pool without process.exit");
}
console.log("Operational lifecycle policy, generic completion guard and compatibility wrapper tests passed.");
