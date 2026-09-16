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
  const [executions, webhooks, recentWebhooks, evidence, recoveryEvents] = await Promise.all([
    db.query(`
      SELECT COUNT(*) FILTER (WHERE callback_received_at IS NULL
          AND status IN ('PENDING', 'SUBMITTED', 'RUNNING'))::int AS awaiting_callbacks,
        COUNT(*) FILTER (WHERE callback_received_at IS NULL
          AND status IN ('PENDING', 'SUBMITTED', 'RUNNING')
          AND COALESCE(submitted_at, created_at) < now() - interval '30 minutes')::int AS delayed_callbacks,
        COUNT(*) FILTER (WHERE status = 'FAILED' AND created_at >= now() - interval '24 hours')::int AS failed_attempts_24h,
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
    delayedCalls: delayed.rows,
    unresolvedWebhooks: recentWebhooks.rows,
    generatedAt: new Date().toISOString()
  };
}
