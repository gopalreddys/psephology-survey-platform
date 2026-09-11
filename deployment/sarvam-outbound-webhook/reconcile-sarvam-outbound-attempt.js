import { config } from "../config/config.js";
import { getSarvamSecret } from "../config/secrets.js";
import { getDb } from "./postgres.js";
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

function collectAppIds(node, target) {
  if (!node || typeof node !== "object") return;

  for (const [key, value] of Object.entries(node)) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z]/g, "");

    if (
      typeof value === "string" &&
      ["appid", "providerappid", "agentid"].includes(normalizedKey) &&
      /^[A-Za-z][A-Za-z0-9_-]{3,}$/.test(value.trim())
    ) {
      target.add(value.trim());
    }

    if (value && typeof value === "object") {
      collectAppIds(value, target);
    }
  }
}

async function resolveAgentAppIds() {
  const db = await getDb();
  const result = await db.query(
    `
      SELECT
        execution.request_payload,
        iteration.voice_agent_snapshot ->> 'app_id' AS iteration_app_id,
        agent.app_id AS catalog_app_id,
        ARRAY(
          SELECT DISTINCT catalog.app_id
          FROM sarvam_voice_agents catalog
          WHERE catalog.app_id IS NOT NULL
            AND length(trim(catalog.app_id)) > 0
          ORDER BY catalog.app_id
        ) AS synchronized_app_ids
      FROM call_executions execution
      LEFT JOIN campaign_runs run ON run.id = execution.run_id
      LEFT JOIN program_iterations iteration ON iteration.id = run.iteration_id
      LEFT JOIN sarvam_voice_agents agent ON agent.id = iteration.voice_agent_id
      WHERE execution.provider_attempt_id = $1
      ORDER BY execution.created_at DESC
      LIMIT 1
    `,
    [attemptId]
  );

  const execution = result.rows[0];

  if (!execution) {
    throw new Error("No platform call execution matches this attempt ID");
  }

  const appIds = new Set();
  collectAppIds(execution.request_payload, appIds);

  for (const value of [
    execution.iteration_app_id,
    execution.catalog_app_id,
    ...(execution.synchronized_app_ids || []),
    config.sarvam.agentId
  ]) {
    if (String(value || "").trim()) appIds.add(String(value).trim());
  }

  if (!appIds.size) {
    throw new Error("No Sarvam agent app ID is available for reconciliation");
  }

  return [...appIds];
}

async function sarvamGet(url) {
  const secret = await getSarvamSecret();
  const response = await fetch(url, {
    method: "GET",
    headers: {
      "X-API-Key": secret.apiKey,
      "Accept": "application/json"
    }
  });
  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const error = new Error(`Sarvam API returned ${response.status}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }

  return body;
}

function analyticsBaseUrl(agentAppId) {
  return `${config.sarvam.baseUrl}/analytics/v1/` +
    `${encodeURIComponent(config.sarvam.organizationId)}/` +
    `${encodeURIComponent(config.sarvam.workspaceId)}/` +
    `${encodeURIComponent(agentAppId)}`;
}

async function getAttemptsForAgent(
  agentAppId,
  filtered = true,
  offset = 0
) {
  const url = new URL(`${analyticsBaseUrl(agentAppId)}/attempts`);
  url.searchParams.set("start_datetime", startDatetime);
  url.searchParams.set("end_datetime", endDatetime);
  url.searchParams.set("limit", "1000");
  url.searchParams.set("offset", String(offset));
  if (filtered) {
    url.searchParams.set(
      "filter_conditions",
      JSON.stringify([
        {
          id: "attempt-id",
          field: "attempt_id",
          operator: "equals",
          value: attemptId
        }
      ])
    );
  }
  return sarvamGet(url);
}

async function getTranscriptForAgent(agentAppId, interactionId) {
  return sarvamGet(
    `${analyticsBaseUrl(agentAppId)}/transcripts/` +
    encodeURIComponent(interactionId)
  );
}

console.log("Fetching Sarvam attempt for reconciliation...", {
  attemptId,
  startDatetime,
  endDatetime
});

const agentAppIds = await resolveAgentAppIds();
console.log("Sarvam agent apps to search:", agentAppIds);

let agentAppId = null;
let attempt = null;

for (const candidateAppId of agentAppIds) {
  let attemptsResult;

  try {
    attemptsResult = await getAttemptsForAgent(candidateAppId);
  } catch (error) {
    if (error.status === 422) {
      attemptsResult = await getAttemptsForAgent(candidateAppId, false);
    } else if (error.status === 404) {
      console.log("Sarvam Analytics app not found:", candidateAppId);
      continue;
    } else {
      throw error;
    }
  }
  let items = attemptItems(attemptsResult);

  console.log("Sarvam Analytics filtered search:", {
    agentAppId: candidateAppId,
    total: Number(attemptsResult?.total ?? items.length),
    returned: items.length
  });

  attempt = items.find((item) => String(item.attempt_id) === attemptId) || null;

  if (!attempt) {
    let offset = 0;
    const pageSize = 1000;
    let total = 0;

    do {
      const unfilteredResult = await getAttemptsForAgent(
        candidateAppId,
        false,
        offset
      );
      items = attemptItems(unfilteredResult);
      total = Number(unfilteredResult?.total ?? items.length);

      console.log("Sarvam Analytics unfiltered page:", {
        agentAppId: candidateAppId,
        offset,
        total,
        returned: items.length
      });

      attempt = items.find(
        (item) => String(item.attempt_id) === attemptId
      ) || null;

      if (attempt || items.length < pageSize) break;
      offset += items.length;
    } while (offset < total);
  }

  if (attempt) {
    agentAppId = candidateAppId;
    break;
  }
}

if (!attempt) {
  console.error(
    "Attempt was not returned by Sarvam Analytics for any platform agent app. Review the per-app totals above before changing platform data."
  );
  process.exit(2);
}

const status = normalizeConnectivity(
  attempt.connectivity_status || attempt.status
);
let transcript = [];

if (attempt.interaction_id) {
  const transcriptResult = await getTranscriptForAgent(
    agentAppId,
    attempt.interaction_id
  );
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
