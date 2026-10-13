import { getDb } from "../db/postgres.js";
import { assertRunAccess } from "./run-access.repository.js";
import { recordLifecycleEvent } from "./lifecycle-audit.repository.js";
import { CLOSED_RUN_STATUSES, terminalAttemptSql, activeExecutionSql, evaluateIterationLifecycle, evaluateRunLifecycle }
  from "./operational-lifecycle-policy.js";
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
        (SELECT COUNT(*)::int FROM campaign_run_contacts contact
          WHERE contact.run_id = run.id) AS total_contacts,
        (SELECT COUNT(*)::int FROM campaign_run_contacts contact
          WHERE contact.run_id = run.id AND NOT (${terminalAttemptSql()})) AS pending_contacts,
        (SELECT COUNT(*)::int FROM call_executions execution
          WHERE execution.run_id = run.id AND ${activeExecutionSql()}) AS active_executions
      FROM campaign_runs run
      LEFT JOIN program_iterations iteration
        ON iteration.id = run.iteration_id
      LEFT JOIN campaign_iteration_links link
        ON link.iteration_id = run.iteration_id
      WHERE run.id = $1
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

export async function loadIterationLifecycleState(db, iterationId) {
  const result = await db.query(
    `
      SELECT
        COUNT(DISTINCT run.id)::int AS total_runs,
        COUNT(DISTINCT run.run_number) FILTER (
          WHERE run.run_number BETWEEN 1 AND 3
            AND UPPER(run.status) = ANY($2::text[])
        )::int AS closed_policy_runs,
        COUNT(DISTINCT run.id) FILTER (
          WHERE UPPER(run.status) <> ALL($2::text[])
        )::int AS open_runs,
        (
          SELECT COUNT(*)::int
          FROM campaign_run_contacts pending_contact
          JOIN campaign_runs pending_run
            ON pending_run.id = pending_contact.run_id
          WHERE pending_run.iteration_id = $1
            AND NOT (${terminalAttemptSql("pending_contact.attempt_status")})
        ) AS pending_contacts,
        (
          SELECT COUNT(*)::int
          FROM call_executions active_execution
          JOIN campaign_runs execution_run
            ON execution_run.id = active_execution.run_id
          WHERE execution_run.iteration_id = $1
            AND ${activeExecutionSql("active_execution.status")}
        ) AS active_executions
      FROM campaign_runs run
      WHERE run.iteration_id = $1
    `,
    [iterationId, CLOSED_RUN_STATUSES]
  );

  return result.rows[0] || {};
}

// The caller owns the transaction. Webhook, recovery and manual closeout all
// use this one audited policy; there is no independent direct completion path.
export async function reconcileIterationLifecycle(db, iterationId, options = {}) {
  await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [String(iterationId)]);
  const contextResult = await db.query(`
    SELECT iteration.status AS iteration_status, link.status AS iteration_link_status,
      link.campaign_id
    FROM program_iterations iteration
    JOIN campaign_iteration_links link ON link.iteration_id = iteration.id
    WHERE iteration.id = $1
    FOR UPDATE OF iteration, link
  `, [iterationId]);
  if (contextResult.rowCount !== 1) {
    const error = new Error("Campaign iteration not found or ambiguous");
    error.statusCode = 404;
    throw error;
  }
  const context = contextResult.rows[0];
  const state = await loadIterationLifecycleState(db, iterationId);
  const policy = evaluateIterationLifecycle(state);
  const protectedStatus = [context.iteration_status, context.iteration_link_status]
    .some((status) => ["LOCKED", "ARCHIVED", "CANCELLED"].includes(String(status || "").toUpperCase()));
  let iterationFinalized = false;
  let retryExhaustedContacts = 0;
  if (policy.readyToComplete && !protectedStatus) {
    retryExhaustedContacts = await exhaustFinalRetryCohort(db, iterationId);
    const linkUpdate = await db.query(`
      UPDATE campaign_iteration_links SET status = 'COMPLETED', updated_at = now()
      WHERE iteration_id = $1 AND status <> 'COMPLETED' RETURNING iteration_id
    `, [iterationId]);
    const iterationUpdate = await db.query(`
      UPDATE program_iterations SET status = 'COMPLETED', updated_at = now()
      WHERE id = $1 AND status <> 'COMPLETED' RETURNING id
    `, [iterationId]);
    iterationFinalized = linkUpdate.rowCount > 0 || iterationUpdate.rowCount > 0;
    if (iterationFinalized) await recordLifecycleEvent(db, {
      entityType: "ITERATION", entityId: iterationId, parentEntityId: context.campaign_id,
      previousStatus: context.iteration_link_status || context.iteration_status,
      nextStatus: "COMPLETED", source: options.source || "SYSTEM", actorId: options.actorId,
      details: { closedPolicyRuns: Number(state.closed_policy_runs), retryExhaustedContacts }
    });
  }
  return { iterationResolved: policy.readyToComplete && !protectedStatus,
    iterationFinalized, retryExhaustedContacts, blockers: protectedStatus
      ? ["Locked, archived or cancelled iterations cannot be completed."] : policy.blockers };
}

async function exhaustFinalRetryCohort(db, iterationId) {
  const result = await db.query(
    `
      WITH contact_history AS (
        SELECT
          contact.id,
          contact.retry_eligible,
          contact.retry_exhausted,
          BOOL_OR(COALESCE(contact.final_status = ANY($2::text[]), FALSE)) OVER (
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
  const runResolved = evaluateRunLifecycle(before);
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

  const { iterationResolved, iterationFinalized, retryExhaustedContacts } =
    await reconcileIterationLifecycle(db, before.iteration_id, options);

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
