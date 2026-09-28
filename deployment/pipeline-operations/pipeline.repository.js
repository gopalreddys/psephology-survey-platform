import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getDb } from "../db/postgres.js";

const runFile = promisify(execFile);
const RECOVERY_TIMER = "psephology-lifecycle-recovery.timer";
const RECOVERY_SERVICE = "psephology-lifecycle-recovery.service";

function properties(output) {
  return Object.fromEntries(
    output.split("\n").filter((line) => line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index), line.slice(index + 1)];
      })
  );
}

async function unitProperties(unit, names) {
  try {
    const { stdout } = await runFile("systemctl", [
      "show", unit, `--property=${names.join(",")}`, "--no-pager"
    ], { timeout: 2500, maxBuffer: 8192 });
    return properties(stdout);
  } catch {
    // This API may run without systemd (for example, in development).
    return null;
  }
}

export async function recoveryTimerStatus() {
  const [timer, service] = await Promise.all([
    unitProperties(RECOVERY_TIMER, ["LoadState", "ActiveState", "SubState", "NextElapseUSecRealtime", "LastTriggerUSec"]),
    unitProperties(RECOVERY_SERVICE, ["Result", "ExecMainStatus"])
  ]);
  return {
    status: !timer || timer.LoadState !== "loaded" ? "unknown"
      : timer.ActiveState === "active" && timer.SubState === "waiting" ? "waiting"
      : "inactive",
    nextTrigger: timer?.NextElapseUSecRealtime || null,
    lastTrigger: timer?.LastTriggerUSec || null,
    lastResult: service?.Result || null,
    lastExitStatus: service?.ExecMainStatus || null
  };
}

export async function getPipelineOverview(options = {}) {
  const db = options.db || await getDb();
  const [executions, webhooks, recentWebhooks, evidence, recoveryEvents,
    integrationConfiguration, latestConversation] = await Promise.all([
    db.query(`
      SELECT COUNT(*) FILTER (WHERE callback_received_at IS NULL
          AND status IN ('PENDING', 'SUBMITTED', 'RUNNING'))::int AS awaiting_callbacks,
        COUNT(*) FILTER (WHERE callback_received_at IS NULL
          AND status IN ('PENDING', 'SUBMITTED', 'RUNNING')
          AND COALESCE(submitted_at, created_at) < now() - interval '30 minutes')::int AS delayed_callbacks,
        COUNT(*) FILTER (WHERE status = 'FAILED' AND created_at >= now() - interval '24 hours')::int AS failed_attempts_24h,
        COUNT(*) FILTER (WHERE created_at >= now() - interval '24 hours')::int AS attempts_24h,
        COUNT(*) FILTER (WHERE provider_attempt_id IS NOT NULL
          AND created_at >= now() - interval '24 hours')::int AS provider_accepted_24h,
        MAX(submitted_at) AS last_submission_at,
        MAX(callback_received_at) AS last_callback_at
      FROM call_executions
    `),
    db.query(`
      SELECT COUNT(*) FILTER (WHERE received_at >= now() - interval '24 hours')::int AS received_24h,
        COUNT(*) FILTER (WHERE received_at >= now() - interval '24 hours'
          AND delivery_status = 'PROCESSED')::int AS processed_24h,
        COUNT(*) FILTER (WHERE delivery_status <> 'PROCESSED')::int AS unresolved_total,
        MAX(received_at) AS last_received_at
      FROM sarvam_outbound_webhook_events
    `),
    db.query(`
      SELECT event.id, event.attempt_id, event.delivery_status, event.error_message,
        event.received_at, event.processed_at, execution.id AS execution_id
      FROM sarvam_outbound_webhook_events event
      LEFT JOIN LATERAL (
        SELECT id FROM call_executions
        WHERE provider_attempt_id = event.attempt_id
        ORDER BY created_at DESC LIMIT 1
      ) execution ON TRUE
      WHERE event.delivery_status <> 'PROCESSED'
      ORDER BY event.received_at DESC LIMIT 20
    `),
    db.query(`
      SELECT COUNT(*) FILTER (WHERE LOWER(COALESCE(connectivity_status, '')) = 'connected'
          AND (jsonb_typeof(interaction_transcript) <> 'array'
            OR interaction_transcript = '[]'::jsonb))::int AS missing_transcripts,
        COUNT(*) FILTER (WHERE LOWER(COALESCE(connectivity_status, '')) = 'connected'
          AND (jsonb_typeof(response_variables) <> 'object'
            OR response_variables = '{}'::jsonb))::int AS missing_responses
      FROM calls
    `),
    db.query(`
      SELECT COUNT(*) FILTER (WHERE created_at >= now() - interval '24 hours')::int AS recovered_24h,
        MAX(created_at) AS last_recovery_at
      FROM operational_lifecycle_events
      WHERE entity_type = 'CALL_EXECUTION'
        AND trigger_source = 'STALE_CALLBACK_RECOVERY'
    `),
    db.query(`
      SELECT
        (SELECT COUNT(*)::int
          FROM sarvam_voice_agents agent
          WHERE agent.is_enabled = TRUE) AS enabled_agents,
        (SELECT COUNT(*)::int
          FROM sarvam_voice_agents agent
          WHERE agent.is_enabled = TRUE
            AND (NULLIF(TRIM(agent.app_id), '') IS NULL
              OR COALESCE(agent.app_version, 0) <= 0
              OR NULLIF(TRIM(agent.connection_id), '') IS NULL
              OR NULLIF(TRIM(agent.outbound_phone_number), '') IS NULL)) AS invalid_enabled_agents,
        (SELECT COUNT(*)::int
          FROM campaign_iteration_links link
          JOIN program_iterations iteration ON iteration.id = link.iteration_id
          WHERE UPPER(COALESCE(link.status, iteration.status, 'PLANNED'))
            NOT IN ('COMPLETED', 'CANCELLED', 'ARCHIVED')) AS open_iterations,
        (SELECT COUNT(*)::int
          FROM campaign_iteration_links link
          JOIN program_iterations iteration ON iteration.id = link.iteration_id
          WHERE UPPER(COALESCE(link.status, iteration.status, 'PLANNED'))
              NOT IN ('COMPLETED', 'CANCELLED', 'ARCHIVED')
            AND (iteration.questionnaire_id IS NULL
              OR iteration.voice_agent_id IS NULL
              OR NULLIF(TRIM(iteration.voice_agent_snapshot ->> 'app_id'), '') IS NULL
              OR CASE
                WHEN COALESCE(iteration.voice_agent_snapshot ->> 'app_version', '') ~ '^[0-9]+$'
                  THEN (iteration.voice_agent_snapshot ->> 'app_version')::int
                ELSE 0
              END <= 0
              OR NULLIF(TRIM(iteration.voice_agent_snapshot ->> 'connection_id'), '') IS NULL
              OR NULLIF(TRIM(iteration.voice_agent_snapshot ->> 'outbound_phone_number'), '') IS NULL))
          AS iteration_configuration_gaps
    `),
    db.query(`
      SELECT execution.id AS execution_id, execution.callback_received_at,
        execution.created_at, call_record.connectivity_status,
        call_record.duration_seconds, call_record.normalized_status,
        CASE WHEN jsonb_typeof(call_record.interaction_transcript) = 'array'
          THEN jsonb_array_length(call_record.interaction_transcript) ELSE 0 END
          AS transcript_turns,
        CASE WHEN jsonb_typeof(call_record.response_variables) = 'object'
          THEN (SELECT COUNT(*) FROM jsonb_object_keys(call_record.response_variables))
          ELSE 0 END AS response_variables,
        COALESCE(execution.request_payload #>> '{providerDeployment,app_id}',
          iteration.voice_agent_snapshot ->> 'app_id') AS app_id,
        CASE
          WHEN COALESCE(execution.request_payload #>> '{providerDeployment,app_version}', '') ~ '^[0-9]+$'
            THEN (execution.request_payload #>> '{providerDeployment,app_version}')::int
          WHEN COALESCE(iteration.voice_agent_snapshot ->> 'app_version', '') ~ '^[0-9]+$'
            THEN (iteration.voice_agent_snapshot ->> 'app_version')::int
          ELSE NULL
        END AS app_version,
        COALESCE(execution.request_payload #>> '{providerDeployment,connection_id}',
          iteration.voice_agent_snapshot ->> 'connection_id') AS connection_id,
        campaign.campaign_name, iteration.iteration_number, run.run_number
      FROM call_executions execution
      JOIN campaign_runs run ON run.id = execution.run_id
      JOIN program_iterations iteration ON iteration.id = run.iteration_id
      LEFT JOIN campaign_iteration_links link ON link.iteration_id = iteration.id
      LEFT JOIN campaigns campaign ON campaign.id = link.campaign_id
      JOIN LATERAL (
        SELECT item.* FROM calls item
        WHERE item.attempt_id = execution.provider_attempt_id
        ORDER BY item.updated_at DESC NULLS LAST LIMIT 1
      ) call_record ON TRUE
      WHERE LOWER(COALESCE(call_record.connectivity_status, '')) = 'connected'
        AND jsonb_typeof(call_record.interaction_transcript) = 'array'
        AND jsonb_array_length(call_record.interaction_transcript) > 0
      ORDER BY execution.callback_received_at DESC NULLS LAST,
        execution.created_at DESC
      LIMIT 1
    `)
  ]);

  const delayed = await db.query(`
    SELECT execution.id AS execution_id, execution.provider_attempt_id,
      execution.status, execution.submitted_at, execution.created_at,
      run.run_number, iteration.iteration_number, iteration.iteration_name,
      campaign.campaign_name
    FROM call_executions execution
    JOIN campaign_runs run ON run.id = execution.run_id
    JOIN program_iterations iteration ON iteration.id = run.iteration_id
    LEFT JOIN campaign_iteration_links link ON link.iteration_id = iteration.id
    LEFT JOIN campaigns campaign ON campaign.id = link.campaign_id
    WHERE execution.callback_received_at IS NULL
      AND execution.status IN ('PENDING', 'SUBMITTED', 'RUNNING')
      AND COALESCE(execution.submitted_at, execution.created_at)
        < now() - interval '30 minutes'
    ORDER BY COALESCE(execution.submitted_at, execution.created_at) ASC
    LIMIT 20
  `);

  return {
    database: { status: "reachable" },
    summary: {
      ...executions.rows[0], ...webhooks.rows[0],
      ...evidence.rows[0], ...recoveryEvents.rows[0]
    },
    integration: integrationConfiguration.rows[0],
    latestConversation: latestConversation.rows[0] || null,
    delayedCalls: delayed.rows,
    unresolvedWebhooks: recentWebhooks.rows,
    generatedAt: new Date().toISOString()
  };
}

function numeric(value) {
  return Number(value || 0);
}

function check(id, area, label, status, message, blocking = false) {
  return { id, area, label, status, message, blocking };
}

export function evaluatePlatformHealth({ overview, timer, now = new Date() }) {
  const summary = overview.summary || {};
  const integration = overview.integration || {};
  const latest = overview.latestConversation;
  const checks = [];

  checks.push(check(
    "api", "CORE", "API service", "PASS",
    "Authenticated Platform Health endpoint responded."
  ));
  checks.push(check(
    "database", "CORE", "Database connectivity",
    overview.database?.status === "reachable" ? "PASS" : "FAIL",
    overview.database?.status === "reachable"
      ? "Operational PostgreSQL queries completed."
      : "The API could not complete its operational database queries.",
    overview.database?.status !== "reachable"
  ));

  const timerHealthy = timer?.status === "waiting" &&
    (!timer.lastResult || timer.lastResult === "success");
  checks.push(check(
    "recovery", "CORE", "Lifecycle recovery",
    timerHealthy ? "PASS" : timer?.status === "unknown" ? "WARN" : "FAIL",
    timerHealthy
      ? "Recovery timer is waiting and the latest observed service result is healthy."
      : timer?.status === "unknown"
        ? "Recovery timer state could not be verified on this host."
        : "Recovery timer or its latest service result needs attention.",
    !timerHealthy
  ));

  const enabledAgents = numeric(integration.enabled_agents);
  const invalidAgents = numeric(integration.invalid_enabled_agents);
  checks.push(check(
    "sarvam-catalog", "SARVAM", "Voice-agent catalogue",
    enabledAgents > 0 && invalidAgents === 0 ? "PASS" : "FAIL",
    enabledAgents === 0
      ? "No enabled Sarvam voice agent is available."
      : invalidAgents > 0
        ? `${invalidAgents} enabled agent record(s) are missing a deployment field.`
        : `${enabledAgents} enabled agent record(s) have complete provider identity.`,
    enabledAgents === 0 || invalidAgents > 0
  ));

  const openIterations = numeric(integration.open_iterations);
  const configurationGaps = numeric(integration.iteration_configuration_gaps);
  checks.push(check(
    "iteration-config", "PRE-LAUNCH", "Open Iteration configuration",
    configurationGaps === 0 ? "PASS" : "FAIL",
    configurationGaps === 0
      ? openIterations
        ? `${openIterations} open Iteration(s) have questionnaire and voice-agent snapshots.`
        : "No open Iteration currently requires launch configuration."
      : `${configurationGaps} open Iteration(s) are missing questionnaire or voice-agent identity.`,
    configurationGaps > 0
  ));

  const delayed = numeric(summary.delayed_callbacks);
  const unresolved = numeric(summary.unresolved_total);
  checks.push(check(
    "callback-pipeline", "SARVAM", "Callback processing",
    delayed === 0 && unresolved === 0 ? "PASS" : "FAIL",
    delayed === 0 && unresolved === 0
      ? "No delayed callback or unresolved webhook event is recorded."
      : `${delayed} delayed callback(s) and ${unresolved} unresolved webhook event(s) require review.`,
    delayed > 0 || unresolved > 0
  ));

  const evidenceGaps = numeric(summary.missing_transcripts) +
    numeric(summary.missing_responses);
  checks.push(check(
    "evidence", "EVIDENCE", "Connected-call evidence",
    evidenceGaps === 0 ? "PASS" : "WARN",
    evidenceGaps === 0
      ? "All connected calls have retained transcripts and response sets."
      : `${evidenceGaps} historical connected-call evidence gap(s) need reconciliation.`
  ));

  let canaryStatus = "FAIL";
  let canaryMessage = "No connected conversation with transcript evidence is available.";
  let canaryBlocking = true;
  if (latest) {
    const observedAt = new Date(latest.callback_received_at || latest.created_at);
    const ageMs = now.getTime() - observedAt.getTime();
    const stale = !Number.isFinite(ageMs) || ageMs > 7 * 24 * 60 * 60 * 1000;
    const progressed = numeric(latest.transcript_turns) >= 4 &&
      numeric(latest.response_variables) > 0 &&
      String(latest.normalized_status || "").toUpperCase() === "SUCCESS_COMPLETE";
    canaryStatus = progressed ? stale ? "WARN" : "PASS" : "FAIL";
    canaryBlocking = !progressed || stale;
    canaryMessage = progressed
      ? `${latest.transcript_turns} turns and ${latest.response_variables} response variables were retained${stale ? ", but the proof is older than seven days" : " in the latest successful conversation"}.`
      : `Latest connected evidence has ${numeric(latest.transcript_turns)} turns, ${numeric(latest.response_variables)} response variables and outcome ${latest.normalized_status || "unknown"}.`;
  }
  checks.push(check(
    "conversation-canary", "PRE-LAUNCH", "End-to-end conversation canary",
    canaryStatus, canaryMessage, canaryBlocking
  ));

  const totals = checks.reduce((result, item) => {
    result[item.status.toLowerCase()] += 1;
    if (item.blocking && item.status !== "PASS") result.blocking += 1;
    return result;
  }, { pass: 0, warn: 0, fail: 0, blocking: 0 });

  return {
    status: totals.blocking > 0 ? "ATTENTION_REQUIRED"
      : totals.warn > 0 ? "READY_WITH_WARNINGS" : "READY",
    ...totals,
    checks
  };
}
