import {
  getAttempts,
  getTranscript
} from "../clients/sarvam.js";
import {
  recordSarvamOutboundResult
} from "../repositories/sarvam-outbound-webhook.repository.js";

const attemptId = String(process.argv[2] || "").trim();

if (!attemptId) {
  console.error(
    "Usage: node src/db/reconcile-sarvam-outbound-attempt.js <provider-attempt-id> [start-iso] [end-iso]"
  );
  process.exit(1);
}

const now = new Date();
const defaultStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
const startDatetime = process.argv[3] || defaultStart.toISOString();
const endDatetime = process.argv[4] || now.toISOString();

function attemptItems(result) {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.items)) return result.items;
  if (Array.isArray(result?.data?.items)) return result.data.items;
  return [];
}

function transcriptItems(result) {
  if (Array.isArray(result)) return result;

  for (const candidate of [
    result?.items,
    result?.transcript,
    result?.interaction_transcript,
    result?.messages,
    result?.data?.items,
    result?.data?.transcript,
    result?.data?.interaction_transcript,
    result?.data?.messages
  ]) {
    if (Array.isArray(candidate)) return candidate;
  }

  return [];
}

function normalizeConnectivity(value) {
  const status = String(value || "").trim().toLowerCase();

  if (["connected", "no_answer", "busy", "failed"].includes(status)) {
    return status;
  }

  throw new Error(
    `Sarvam returned unsupported connectivity status: ${value || "missing"}`
  );
}

console.log("Fetching Sarvam attempt for reconciliation...", {
  attemptId,
  startDatetime,
  endDatetime
});

const attemptsResult = await getAttempts({
  startDatetime,
  endDatetime,
  limit: 1000,
  offset: 0
});
const attempt = attemptItems(attemptsResult)
  .find((item) => String(item.attempt_id) === attemptId);

if (!attempt) {
  console.error(
    "Attempt was not returned by Sarvam Analytics. Confirm the date window and the agent app used for this call."
  );
  process.exit(2);
}

const status = normalizeConnectivity(
  attempt.connectivity_status || attempt.status
);
let transcript = [];

if (attempt.interaction_id) {
  const transcriptResult = await getTranscript(attempt.interaction_id);
  transcript = transcriptItems(transcriptResult);
}

const agentVariables =
  attempt.agent_variables && typeof attempt.agent_variables === "object"
    ? attempt.agent_variables
    : {};

const result = await recordSarvamOutboundResult({
  attempt_id: attempt.attempt_id,
  status,
  channel_info: {
    channel_type: attempt.channel_type || null,
    channel_provider: attempt.channel_provider || null,
    agent_phone_number: attempt.agent_phone_number || null
  },
  duration: attempt.duration_in_seconds ?? attempt.duration ?? null,
  interaction_id: attempt.interaction_id || null,
  failure_reason: attempt.failure_reason || null,
  final_agent_variables: agentVariables,
  webhook_config: {
    url: "ANALYTICS_RECONCILIATION",
    metadata: agentVariables
  },
  interaction_transcript: transcript
});

console.log("Sarvam attempt reconciliation completed:", {
  attemptId: result.attemptId,
  matched: result.matched !== false,
  duplicate: Boolean(result.duplicate),
  status: result.status || null,
  transcriptTurns: result.transcriptTurns || 0,
  responseVariables: result.responseVariables || 0
});

process.exit(result.matched === false ? 3 : 0);
