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
const { buildCallIssueTrace, evaluatePlatformHealth, getPipelineOverview } = await import(
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
assert.match(repository, /CONVERSATION_OPENING_LOOP/);
assert.match(repository, /createInstantOutboundCall/);
assert.match(repository, /FROM call_executions execution\s+JOIN LATERAL/);
assert.match(repository, /"COMPLETED",\s+"SUCCESS_COMPLETE"/);
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
  if (sql.includes("AS submitted_app_id")) return { rows: [{
    execution_id: "trace", run_contact_id: "contact",
    provider_attempt_id: "provider", execution_status: "COMPLETED",
    submitted_at: "2026-09-27T08:00:00.000Z",
    callback_received_at: "2026-09-27T08:10:00.000Z",
    submitted_app_id: "Political-A-test", submitted_app_version: "5",
    submitted_connection_id: "connection", snapshot_app_id: "Political-A-test",
    snapshot_app_version: "5", snapshot_connection_id: "connection",
    connectivity_status: "connected", normalized_status: "SUCCESS_COMPLETE",
    interaction_transcript: [
      { role: "agent", text: "Hello, do you have two minutes?" },
      { role: "user", text: "Yes" },
      { role: "agent", text: "Hello, do you have two minutes?" }
    ],
    transcript_turns: 3, response_variables: 4,
    campaign_name: "Campaign", iteration_number: 2, run_number: 3
  }] };
  if (sql.includes("AS transcript_turns")) return { rows: [{
    execution_id: "canary", callback_received_at: "2026-09-27T08:10:00.000Z",
    created_at: "2026-09-27T08:00:00.000Z", connectivity_status: "connected",
    duration_seconds: 588, normalized_status: "SUCCESS_COMPLETE",
    transcript_turns: 39, response_variables: 44, app_id: "Political-A-test",
    app_version: 5, connection_id: "connection", campaign_name: "Campaign",
    iteration_number: 2, run_number: 3
  }] };
  if (sql.includes("AS resolved_contacts")) return { rows: [] };
  if (sql.includes("AS execution_id")) return { rows: [{
    execution_id: "execution", campaign_name: "Campaign"
  }] };
  throw new Error("Unexpected Pipeline query");
} };

const result = await getPipelineOverview({ db });
assert.equal(calls.length, 10);
assert.equal(result.summary.delayed_callbacks, 1);
assert.equal(result.summary.unresolved_total, 1);
assert.equal(result.summary.missing_transcripts, 1);
assert.equal(result.delayedCalls.length, 1);
assert.equal(result.unresolvedWebhooks.length, 1);
assert.equal(result.issueTrace.runtime.status, "ATTENTION_REQUIRED");
assert.equal(result.issueTrace.runtime.incidents.some((item) =>
  item.code === "CONVERSATION_OPENING_LOOP"), false);
assert.equal(result.issueTrace.history.buckets.some((item) =>
  item.code === "CONVERSATION_OPENING_LOOP" && item.solutionStatus === "IMPLEMENTED"), true);
assert.deepEqual(result.database, { status: "reachable" });

const completedEvidence = buildCallIssueTrace({
  executions: [{
    execution_id: "completed-evidence", execution_status: "COMPLETED",
    provider_attempt_id: "completed-attempt", connectivity_status: "connected",
    normalized_status: "COMPLETED", transcript_turns: 12, response_variables: 8,
    callback_received_at: "2026-09-28T07:30:00.000Z",
    created_at: "2026-09-28T07:20:00.000Z", is_latest_for_contact: true
  }],
  webhooks: [], lifecycleDrifts: [], now: new Date("2026-09-28T08:00:00.000Z")
});
assert.equal(completedEvidence.runtime.incidents.some((item) =>
  item.code === "CONNECTED_INCOMPLETE"), false);

const trace = buildCallIssueTrace({
  now: new Date("2026-09-28T08:00:00.000Z"),
  executions: [{
    execution_id: "rejected", execution_status: "FAILED",
    provider_attempt_id: null,
    error_message: "Sarvam Instant Outbound returned 422 for +919999999999",
    created_at: "2026-09-28T07:00:00.000Z", campaign_name: "Campaign",
    iteration_number: 1, run_number: 1, run_status: "RUNNING",
    iteration_status: "ACTIVE", iteration_link_status: "IN_PROGRESS",
    contact_final_status: "PENDING", contact_retry_exhausted: false,
    is_latest_for_contact: true
  }, {
    execution_id: "drift", run_contact_id: "contact", execution_status: "SUBMITTED",
    provider_attempt_id: "attempt", callback_received_at: null,
    submitted_at: "2026-09-28T06:00:00.000Z",
    submitted_app_id: "Agent", submitted_app_version: "5",
    submitted_connection_id: "connection-a", snapshot_app_id: "Agent",
    snapshot_app_version: "4", snapshot_connection_id: "connection-a",
    run_status: "RUNNING", iteration_status: "ACTIVE",
    iteration_link_status: "IN_PROGRESS", contact_final_status: "PENDING",
    contact_retry_exhausted: false, is_latest_for_contact: true
  }],
  webhooks: [], lifecycleDrifts: []
});
assert.equal(trace.runtime.showstoppers, 3);
assert.deepEqual(
  trace.runtime.incidents.map((item) => item.code).sort(),
  ["AGENT_DEPLOYMENT_DRIFT", "CALLBACK_DELAYED", "PROVIDER_REJECTED"].sort()
);
assert.equal(trace.runtime.incidents[0].involved.length > 0, true);
assert.equal(trace.runtime.incidents[0].preliminaryFixes.length, 3);
assert.equal(trace.runtime.incidents[0].matchedHistoricalControl.controlPrograms.length > 0, true);
assert.equal(trace.runtime.incidents.some((item) => item.evidence.includes("9999999999")), false);

const completedDrift = buildCallIssueTrace({
  executions: [{
    execution_id: "completed-drift", run_contact_id: "drift-contact",
    execution_status: "COMPLETED", provider_attempt_id: "old-version-attempt",
    submitted_at: "2026-09-25T09:00:00.000Z",
    callback_received_at: "2026-09-25T09:05:00.000Z",
    submitted_app_id: "Agent", submitted_app_version: "4",
    submitted_connection_id: "connection", snapshot_app_id: "Agent",
    snapshot_app_version: "5", snapshot_connection_id: "connection",
    run_status: "RUNNING", iteration_status: "DRAFT",
    iteration_link_status: "PLANNED", contact_final_status: "PENDING",
    contact_retry_exhausted: false, is_latest_for_contact: true
  }],
  webhooks: [], lifecycleDrifts: []
});
assert.equal(completedDrift.runtime.incidents.some((item) =>
  item.code === "AGENT_DEPLOYMENT_DRIFT"), false);
assert.equal(completedDrift.history.buckets.some((item) =>
  item.code === "AGENT_DEPLOYMENT_DRIFT"), true);

const retryBase = {
  run_contact_id: "retry-contact", execution_status: "FAILED",
  run_status: "RUNNING", iteration_status: "DRAFT",
  iteration_link_status: "PLANNED", contact_final_status: "PENDING",
  contact_retry_exhausted: false
};
const sequentialRetries = buildCallIssueTrace({
  executions: [{
    ...retryBase, execution_id: "retry-one", provider_attempt_id: "attempt-one",
    submitted_at: "2026-09-25T09:00:00.000Z",
    callback_received_at: "2026-09-25T09:05:00.000Z", is_latest_for_contact: false
  }, {
    ...retryBase, execution_id: "retry-two", provider_attempt_id: "attempt-two",
    submitted_at: "2026-09-26T09:00:00.000Z",
    callback_received_at: "2026-09-26T09:05:00.000Z", is_latest_for_contact: true
  }],
  webhooks: [], lifecycleDrifts: []
});
assert.equal(sequentialRetries.runtime.incidents.some((item) =>
  item.code === "DUPLICATE_PROVIDER_START"), false);
assert.equal(sequentialRetries.history.buckets.some((item) =>
  item.code === "DUPLICATE_PROVIDER_START"), false);

const overlappingStarts = buildCallIssueTrace({
  executions: [{
    ...retryBase, execution_id: "overlap-one", provider_attempt_id: "overlap-attempt-one",
    submitted_at: "2026-09-28T09:00:00.000Z",
    callback_received_at: "2026-09-28T09:05:00.000Z", is_latest_for_contact: false
  }, {
    ...retryBase, execution_id: "overlap-two", provider_attempt_id: "overlap-attempt-two",
    submitted_at: "2026-09-28T09:00:05.000Z",
    callback_received_at: "2026-09-28T09:06:00.000Z", is_latest_for_contact: true
  }],
  webhooks: [], lifecycleDrifts: []
});
assert.equal(overlappingStarts.runtime.incidents.some((item) =>
  item.code === "DUPLICATE_PROVIDER_START"), true);

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

const completedCanaryHealth = evaluatePlatformHealth({
  overview: {
    ...readyOverview,
    latestConversation: {
      ...readyOverview.latestConversation,
      normalized_status: "COMPLETED"
    }
  },
  timer: { status: "waiting", lastResult: "success" },
  now: new Date("2026-09-28T08:00:00.000Z")
});
assert.equal(
  completedCanaryHealth.checks.find((item) => item.id === "conversation-canary").status,
  "PASS"
);

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
