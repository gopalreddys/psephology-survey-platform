import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const routes = readFileSync(path.join(here, "pipeline.routes.js"), "utf8");
const installer = readFileSync(path.join(here, "install-pipeline.js"), "utf8");
const repository = readFileSync(path.join(here, "pipeline.repository.js"), "utf8");
const testableRepository = repository.replace(
  'import { getDb } from "../db/postgres.js";',
  "const getDb = async () => { throw new Error('Unexpected database access'); };"
);
const { evaluatePlatformHealth, getPipelineOverview } = await import(
  `data:text/javascript,${encodeURIComponent(testableRepository)}`
);

assert.match(routes, /requireAuth/);
assert.match(routes, /requireRole\(\["SUPER_ADMIN"\]\)/);
assert.match(routes, /"\/pipeline"/);
assert.match(installer, /PIPELINE_OPERATIONS_V1/);
assert.match(installer, /\.bak-pipeline-/);
assert.match(repository, /systemctl/);
assert.match(repository, /STALE_CALLBACK_RECOVERY/);
assert.match(repository, /End-to-end conversation canary/);
assert.match(repository, /iteration_configuration_gaps/);
assert.doesNotMatch(repository, /raw_payload|voter\.phone_number|interaction_transcript\s+AS/);

const calls = [];
const db = { query: async (sql) => {
  calls.push(sql);
  if (sql.includes("AS awaiting_callbacks")) return { rows: [{
    awaiting_callbacks: 2, delayed_callbacks: 1, failed_attempts_24h: 3,
    attempts_24h: 4, provider_accepted_24h: 4,
    last_submission_at: null, last_callback_at: null
  }] };
  if (sql.includes("AS received_24h")) return { rows: [{
    received_24h: 4, processed_24h: 3, unresolved_total: 1, last_received_at: null
  }] };
  if (sql.includes("event.delivery_status <> 'PROCESSED'")) return { rows: [{
    id: "event", attempt_id: "attempt", delivery_status: "UNMATCHED",
    error_message: "No matching call execution", execution_id: null
  }] };
  if (sql.includes("AS missing_transcripts")) return { rows: [{
    missing_transcripts: 1, missing_responses: 0
  }] };
  if (sql.includes("AS recovered_24h")) return { rows: [{
    recovered_24h: 1, last_recovery_at: null
  }] };
  if (sql.includes("AS enabled_agents")) return { rows: [{
    enabled_agents: 2, invalid_enabled_agents: 0,
    open_iterations: 1, iteration_configuration_gaps: 0
  }] };
  if (sql.includes("AS transcript_turns")) return { rows: [{
    execution_id: "canary", callback_received_at: "2026-09-27T08:10:00.000Z",
    created_at: "2026-09-27T08:00:00.000Z", connectivity_status: "connected",
    duration_seconds: 588, normalized_status: "SUCCESS_COMPLETE",
    transcript_turns: 39, response_variables: 44, app_id: "Political-A-test",
    app_version: 5, connection_id: "connection", campaign_name: "Campaign",
    iteration_number: 2, run_number: 3
  }] };
  if (sql.includes("AS execution_id")) return { rows: [{
    execution_id: "execution", campaign_name: "Campaign"
  }] };
  throw new Error("Unexpected Pipeline query");
} };

const result = await getPipelineOverview({ db });
assert.equal(calls.length, 8);
assert.equal(result.summary.delayed_callbacks, 1);
assert.equal(result.summary.unresolved_total, 1);
assert.equal(result.summary.missing_transcripts, 1);
assert.equal(result.delayedCalls.length, 1);
assert.equal(result.unresolvedWebhooks.length, 1);
assert.deepEqual(result.database, { status: "reachable" });

const readyOverview = {
  ...result,
  summary: {
    ...result.summary,
    delayed_callbacks: 0,
    unresolved_total: 0,
    missing_transcripts: 0,
    missing_responses: 0
  }
};
const health = evaluatePlatformHealth({
  overview: readyOverview,
  timer: { status: "waiting", lastResult: "success" },
  now: new Date("2026-09-28T08:00:00.000Z")
});
assert.equal(health.status, "READY");
assert.equal(health.blocking, 0);
assert.equal(health.checks.length, 8);
assert.equal(health.checks.find((item) => item.id === "conversation-canary").status, "PASS");

const blocked = evaluatePlatformHealth({
  overview: {
    ...readyOverview,
    integration: { ...readyOverview.integration, iteration_configuration_gaps: 1 }
  },
  timer: { status: "waiting", lastResult: "success" },
  now: new Date("2026-09-28T08:00:00.000Z")
});
assert.equal(blocked.status, "ATTENTION_REQUIRED");
assert.equal(blocked.checks.find((item) => item.id === "iteration-config").blocking, true);
console.log("Pipeline scope, diagnostics and install checks passed.");
