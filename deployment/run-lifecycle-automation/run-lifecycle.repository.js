import { getDb } from "../db/postgres.js";
import { assertRunAccess } from "./run-access.repository.js";
import { recordLifecycleEvent } from "./lifecycle-audit.repository.js";

const CLOSED_RUN_STATUSES = [
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "ARCHIVED"
];
const SUCCESS_STATUSES = [
  "SUCCESS_PULSE",
  "SUCCESS_COMPLETE",
  "SUCCESS_SUBSTANTIAL"
];

async function lifecycleState(db, runId) {
  const result = await db.query(
    `
      SELECT
        run.id,
        run.iteration_id,
        run.run_number,
        run.status AS run_status,
        iteration.status AS iteration_status,
        link.status AS iteration_link_status,
        link.campaign_id,
        COUNT(DISTINCT contact.id)::int AS total_contacts,
        COUNT(DISTINCT contact.id) FILTER (
          WHERE COALESCE(contact.attempt_status, 'PENDING')
            NOT IN ('COMPLETED', 'FAILED')
        )::int AS pending_contacts,
        COUNT(DISTINCT execution.id) FILTER (
          WHERE COALESCE(execution.status, 'PENDING')
            NOT IN ('COMPLETED', 'FAILED', 'CANCELLED')
        )::int AS active_executions
      FROM campaign_runs run
      LEFT JOIN program_iterations iteration
        ON iteration.id = run.iteration_id
      LEFT JOIN campaign_iteration_links link
        ON link.iteration_id = run.iteration_id
      LEFT JOIN campaign_run_contacts contact
        ON contact.run_id = run.id
      LEFT JOIN call_executions execution
        ON execution.run_id = run.id
      WHERE run.id = $1
      GROUP BY run.id, run.iteration_id, run.run_number, run.status,
        iteration.status, link.status, link.campaign_id
    `,
    [runId]
  );

  if (!result.rowCount) {
    const error = new Error("Run not found");
    error.statusCode = 404;
    throw error;
  }

  return result.rows[0];
}

async function iterationState(db, iterationId) {
  const result = await db.query(
    `
      SELECT
        COUNT(DISTINCT run.run_number) FILTER (
          WHERE run.run_number BETWEEN 1 AND 3
            AND UPPER(run.status) = ANY($2::text[])
        )::int AS closed_policy_runs,
        COUNT(DISTINCT run.id) FILTER (
          WHERE UPPER(run.status) <> ALL($2::text[])
        )::int AS open_runs,
        EXISTS (
          SELECT 1
          FROM campaign_run_contacts pending_contact
          JOIN campaign_runs pending_run
            ON pending_run.id = pending_contact.run_id
          WHERE pending_run.iteration_id = $1
            AND COALESCE(pending_contact.attempt_status, 'PENDING')
              NOT IN ('COMPLETED', 'FAILED')
        ) AS has_pending_contacts,
        EXISTS (
          SELECT 1
          FROM call_executions active_execution
          JOIN campaign_runs execution_run
            ON execution_run.id = active_execution.run_id
          WHERE execution_run.iteration_id = $1
            AND COALESCE(active_execution.status, 'PENDING')
              NOT IN ('COMPLETED', 'FAILED', 'CANCELLED')
        ) AS has_active_executions
      FROM campaign_runs run
      WHERE run.iteration_id = $1
    `,
    [iterationId, CLOSED_RUN_STATUSES]
  );

  return result.rows[0] || {};
}

async function exhaustFinalRetryCohort(db, iterationId) {
  const result = await db.query(
    `
      WITH contact_history AS (
        SELECT
          contact.id,
          contact.retry_eligible,
          contact.retry_exhausted,
          BOOL_OR(contact.final_status = ANY($2::text[])) OVER (
            PARTITION BY contact.voter_id
          ) AS successful,
          ROW_NUMBER() OVER (
            PARTITION BY contact.voter_id
            ORDER BY run.run_number DESC, contact.id DESC
          ) AS latest_position
        FROM campaign_run_contacts contact
        JOIN campaign_runs run
          ON run.id = contact.run_id
        WHERE run.iteration_id = $1
      ), final_retry_contacts AS (
        SELECT id
        FROM contact_history
        WHERE latest_position = 1
          AND successful = FALSE
          AND retry_eligible = TRUE
          AND retry_exhausted = FALSE
      )
      UPDATE campaign_run_contacts contact
      SET retry_eligible = FALSE,
          retry_exhausted = TRUE,
          final_status = CASE
            WHEN COALESCE(contact.final_status, 'PENDING') = 'PENDING'
              THEN 'RETRY_EXHAUSTED'
            ELSE contact.final_status
          END,
          completion_reason = COALESCE(
            contact.completion_reason,
            'Three-Run retry policy completed'
          )
      WHERE contact.id IN (SELECT id FROM final_retry_contacts)
      RETURNING contact.id
    `,
    [iterationId, SUCCESS_STATUSES]
  );

  return result.rowCount;
}

export async function reconcileRunLifecycle(db, runId, options = {}) {
  await db.query(
    "SELECT pg_advisory_xact_lock(hashtext($1))",
    [String(runId)]
  );

  const before = await lifecycleState(db, runId);
  const runResolved =
    Number(before.total_contacts || 0) > 0 &&
    Number(before.pending_contacts || 0) === 0 &&
    Number(before.active_executions || 0) === 0;
  const runAlreadyClosed = CLOSED_RUN_STATUSES.includes(
    String(before.run_status || "").toUpperCase()
  );
  let runFinalized = false;

  if (runResolved) {
    await db.query(
      `
        UPDATE campaign_run_cycles
        SET status = 'COMPLETED'
        WHERE run_id = $1
          AND status IN ('READY', 'RUNNING')
      `,
      [runId]
    );

    if (!runAlreadyClosed) {
      const updateResult = await db.query(
        `
          UPDATE campaign_runs
          SET status = 'COMPLETED',
              updated_at = now()
          WHERE id = $1
            AND status NOT IN ('COMPLETED', 'FAILED', 'CANCELLED', 'ARCHIVED')
          RETURNING id
        `,
        [runId]
      );
      runFinalized = updateResult.rowCount > 0;

      if (runFinalized) {
        await recordLifecycleEvent(db, {
          entityType: "RUN",
          entityId: runId,
          parentEntityId: before.campaign_id,
          previousStatus: before.run_status,
          nextStatus: "COMPLETED",
          source: options.source || "SYSTEM",
          actorId: options.actorId,
          details: {
            iterationId: before.iteration_id,
            runNumber: Number(before.run_number),
            totalContacts: Number(before.total_contacts || 0)
          }
        });
      }
    }
  }

  await db.query(
    "SELECT pg_advisory_xact_lock(hashtext($1))",
    [String(before.iteration_id)]
  );
  const iteration = await iterationState(db, before.iteration_id);
  const iterationResolved =
    Number(iteration.closed_policy_runs || 0) === 3 &&
    Number(iteration.open_runs || 0) === 0 &&
    iteration.has_pending_contacts !== true &&
    iteration.has_active_executions !== true;
  let iterationFinalized = false;
  let retryExhaustedContacts = 0;

  if (iterationResolved) {
    retryExhaustedContacts = await exhaustFinalRetryCohort(
      db,
      before.iteration_id
    );

    const linkUpdate = await db.query(
      `
        UPDATE campaign_iteration_links
        SET status = 'COMPLETED', updated_at = now()
        WHERE iteration_id = $1
          AND status <> 'COMPLETED'
        RETURNING iteration_id
      `,
      [before.iteration_id]
    );
    const iterationUpdate = await db.query(
      `
        UPDATE program_iterations
        SET status = 'COMPLETED', updated_at = now()
        WHERE id = $1
          AND status <> 'COMPLETED'
        RETURNING id
      `,
      [before.iteration_id]
    );
    iterationFinalized =
      linkUpdate.rowCount > 0 || iterationUpdate.rowCount > 0;

    if (iterationFinalized) {
      await recordLifecycleEvent(db, {
        entityType: "ITERATION",
        entityId: before.iteration_id,
        parentEntityId: before.campaign_id,
        previousStatus: before.iteration_link_status || before.iteration_status,
        nextStatus: "COMPLETED",
        source: options.source || "SYSTEM",
        actorId: options.actorId,
        details: {
          closedPolicyRuns: Number(iteration.closed_policy_runs || 0),
          retryExhaustedContacts
        }
      });
    }
  }

  const after = await lifecycleState(db, runId);

  return {
    runId: before.id,
    iterationId: before.iteration_id,
    runNumber: Number(before.run_number),
    runStatus: after.run_status,
    runResolved,
    runFinalized,
    iterationResolved,
    iterationFinalized,
    retryExhaustedContacts,
    pendingContacts: Number(after.pending_contacts || 0),
    activeExecutions: Number(after.active_executions || 0)
  };
}

export async function reconcileRunLifecycleById(runId, actor) {
  await assertRunAccess(runId, actor);
  const pool = await getDb();
  const db = await pool.connect();

  try {
    await db.query("BEGIN");
    const result = await reconcileRunLifecycle(db, runId, {
      source: "MANUAL_RECONCILIATION",
      actorId: actor.id
    });
    await db.query("COMMIT");
    return result;
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}
