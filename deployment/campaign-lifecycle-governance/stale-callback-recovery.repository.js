import { getDb } from "../db/postgres.js";
import { recordLifecycleEvent } from "./lifecycle-audit.repository.js";
import { reconcileRunLifecycle } from "./run-lifecycle.repository.js";

const DEFAULT_STALE_MINUTES = 30;

function staleMinutes(value) {
  const parsed = Number(value || process.env.RUN_CALLBACK_STALE_MINUTES);
  return Number.isFinite(parsed) && parsed >= 15
    ? Math.floor(parsed)
    : DEFAULT_STALE_MINUTES;
}

export async function listStaleCallbackCandidates(options = {}) {
  const db = options.db || await getDb();
  const thresholdMinutes = staleMinutes(options.thresholdMinutes);
  const result = await db.query(
    `
      SELECT
        execution.id AS execution_id,
        execution.provider_attempt_id,
        execution.status AS execution_status,
        execution.updated_at,
        execution.run_contact_id,
        run.id AS run_id,
        run.run_number,
        run.iteration_id,
        link.campaign_id,
        voter.full_name,
        RIGHT(regexp_replace(COALESCE(voter.phone_number, ''), '[^0-9]', '', 'g'), 4)
          AS phone_ending
      FROM call_executions execution
      JOIN campaign_runs run ON run.id = execution.run_id
      LEFT JOIN campaign_iteration_links link ON link.iteration_id = run.iteration_id
      LEFT JOIN voter_master voter ON voter.id = execution.voter_id
      WHERE UPPER(COALESCE(execution.status, 'PENDING')) IN (
          'PENDING', 'SUBMITTED', 'RUNNING'
        )
        AND execution.provider_attempt_id IS NOT NULL
        AND execution.callback_received_at IS NULL
        AND execution.updated_at < now() - ($1::int * interval '1 minute')
      ORDER BY execution.updated_at
    `,
    [thresholdMinutes]
  );

  return { thresholdMinutes, items: result.rows };
}

export async function recoverStaleCallbacks(options = {}) {
  const thresholdMinutes = staleMinutes(options.thresholdMinutes);
  const source = options.source || "STALE_CALLBACK_RECOVERY";
  const pool = await getDb();
  const db = await pool.connect();
  const recovered = [];

  try {
    await db.query("BEGIN");
    const candidates = await db.query(
      `
        SELECT
          execution.id AS execution_id,
          execution.status AS execution_status,
          execution.run_contact_id,
          run.id AS run_id,
          run.run_number,
          run.iteration_id,
          link.campaign_id
        FROM call_executions execution
        JOIN campaign_runs run ON run.id = execution.run_id
        LEFT JOIN campaign_iteration_links link ON link.iteration_id = run.iteration_id
        WHERE UPPER(COALESCE(execution.status, 'PENDING')) IN (
            'PENDING', 'SUBMITTED', 'RUNNING'
          )
          AND execution.provider_attempt_id IS NOT NULL
          AND execution.callback_received_at IS NULL
          AND execution.updated_at < now() - ($1::int * interval '1 minute')
        ORDER BY execution.updated_at
        FOR UPDATE OF execution SKIP LOCKED
      `,
      [thresholdMinutes]
    );

    const affectedRunIds = new Set();

    for (const candidate of candidates.rows) {
      const message = `Provider callback not received within ${thresholdMinutes} minutes`;
      const executionUpdate = await db.query(
        `
          UPDATE call_executions
          SET status = 'FAILED',
              error_message = COALESCE(error_message, $2),
              completed_at = COALESCE(completed_at, now()),
              updated_at = now()
          WHERE id = $1
            AND callback_received_at IS NULL
            AND UPPER(COALESCE(status, 'PENDING')) IN (
              'PENDING', 'SUBMITTED', 'RUNNING'
            )
          RETURNING id
        `,
        [candidate.execution_id, message]
      );

      if (!executionUpdate.rowCount) continue;

      const retryAllowed = Number(candidate.run_number) < 3;
      await db.query(
        `
          UPDATE campaign_run_contacts
          SET attempt_status = 'FAILED',
              final_status = CASE
                WHEN $2 THEN 'PENDING'
                ELSE 'RETRY_EXHAUSTED'
              END,
              retry_eligible = $2,
              retry_exhausted = NOT $2,
              final_outcome = 'STALE_CALLBACK',
              completion_reason = $3,
              completed_at = CASE WHEN $2 THEN completed_at ELSE now() END
          WHERE id = $1
        `,
        [candidate.run_contact_id, retryAllowed, message]
      );

      await recordLifecycleEvent(db, {
        entityType: "CALL_EXECUTION",
        entityId: candidate.execution_id,
        parentEntityId: candidate.campaign_id,
        previousStatus: candidate.execution_status,
        nextStatus: "FAILED",
        source,
        details: {
          reason: "STALE_CALLBACK",
          thresholdMinutes,
          runId: candidate.run_id,
          iterationId: candidate.iteration_id,
          retryEligible: retryAllowed
        }
      });

      affectedRunIds.add(candidate.run_id);
      recovered.push(candidate.execution_id);
    }

    const lifecycle = [];
    for (const runId of affectedRunIds) {
      lifecycle.push(await reconcileRunLifecycle(db, runId, { source }));
    }

    await db.query("COMMIT");
    return {
      thresholdMinutes,
      recoveredExecutions: recovered.length,
      affectedRuns: affectedRunIds.size,
      lifecycle
    };
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}
