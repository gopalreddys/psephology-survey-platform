import { getDb } from "../db/postgres.js";
import { assertIterationAccess } from "./iteration-access.repository.js";
import { loadIterationLifecycleState, reconcileIterationLifecycle } from "./run-lifecycle.repository.js";
import { CLOSED_RUN_STATUSES, terminalAttemptSql, evaluateIterationLifecycle }
  from "./operational-lifecycle-policy.js";

const SUCCESS_STATUSES = [
  "SUCCESS_PULSE",
  "SUCCESS_COMPLETE",
  "SUCCESS_SUBSTANTIAL"
];

function errorWithStatus(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

async function loadCloseout(client, iterationId) {
  const iterationResult = await client.query(
    `
      SELECT
        iteration.id,
        iteration.iteration_number,
        iteration.iteration_name,
        link.campaign_id,
        campaign.campaign_name,
        campaign.campaign_manager_user_id,
        iteration.status AS program_status,
        link.status AS link_status,
        COALESCE(link.status, iteration.status) AS status
      FROM program_iterations iteration
      JOIN campaign_iteration_links link
        ON link.iteration_id = iteration.id
      JOIN campaigns campaign
        ON campaign.id = link.campaign_id
      WHERE iteration.id = $1
      LIMIT 1
    `,
    [iterationId]
  );

  if (!iterationResult.rowCount) {
    throw errorWithStatus("Campaign iteration not found", 404);
  }

  const runsResult = await client.query(
    `
      WITH contact_stats AS (
        SELECT
          contact.run_id,
          COUNT(*)::int AS selected_contacts,
          COUNT(*) FILTER (
            WHERE contact.final_status = ANY($2::text[])
          )::int AS successful_contacts,
          COUNT(*) FILTER (
            WHERE contact.attempt_status = 'FAILED'
          )::int AS failed_contacts,
          COUNT(*) FILTER (
            WHERE contact.retry_eligible = TRUE
              AND contact.retry_exhausted = FALSE
          )::int AS retry_eligible_contacts,
          COUNT(*) FILTER (
            WHERE contact.retry_exhausted = TRUE
          )::int AS retry_exhausted_contacts,
          COUNT(*) FILTER (
            WHERE NOT (${terminalAttemptSql()})
          )::int AS pending_contacts
        FROM campaign_run_contacts contact
        JOIN campaign_runs selected_run
          ON selected_run.id = contact.run_id
        WHERE selected_run.iteration_id = $1
        GROUP BY contact.run_id
      ), execution_stats AS (
        SELECT
          execution.run_id,
          COUNT(*)::int AS call_attempts,
          COUNT(*) FILTER (
            WHERE execution.callback_received_at IS NOT NULL
          )::int AS callbacks_received
        FROM call_executions execution
        JOIN campaign_runs execution_run
          ON execution_run.id = execution.run_id
        WHERE execution_run.iteration_id = $1
        GROUP BY execution.run_id
      ), transcript_stats AS (
        SELECT
          call_record.run_id,
          COUNT(*) FILTER (
            WHERE CASE
              WHEN jsonb_typeof(call_record.interaction_transcript) = 'array'
                THEN jsonb_array_length(call_record.interaction_transcript) > 0
              ELSE FALSE
            END
          )::int AS transcripts_captured
        FROM calls call_record
        WHERE call_record.iteration_id = $1
        GROUP BY call_record.run_id
      )
      SELECT
        run.id,
        run.run_number,
        run.run_name,
        run.status,
        run.created_at,
        COALESCE(contact.selected_contacts, 0)::int AS selected_contacts,
        COALESCE(contact.successful_contacts, 0)::int AS successful_contacts,
        COALESCE(contact.failed_contacts, 0)::int AS failed_contacts,
        COALESCE(contact.retry_eligible_contacts, 0)::int AS retry_eligible_contacts,
        COALESCE(contact.retry_exhausted_contacts, 0)::int AS retry_exhausted_contacts,
        COALESCE(contact.pending_contacts, 0)::int AS pending_contacts,
        COALESCE(execution.call_attempts, 0)::int AS call_attempts,
        COALESCE(execution.callbacks_received, 0)::int AS callbacks_received,
        COALESCE(transcript.transcripts_captured, 0)::int AS transcripts_captured
      FROM campaign_runs run
      LEFT JOIN contact_stats contact
        ON contact.run_id = run.id
      LEFT JOIN execution_stats execution
        ON execution.run_id = run.id
      LEFT JOIN transcript_stats transcript
        ON transcript.run_id = run.id
      WHERE run.iteration_id = $1
      ORDER BY run.run_number
    `,
    [iterationId, SUCCESS_STATUSES]
  );

  const outcomesResult = await client.query(
    `
      WITH contact_history AS (
        SELECT
          contact.voter_id,
          contact.retry_eligible,
          contact.retry_exhausted,
          contact.final_status,
          BOOL_OR(
            COALESCE(contact.final_status = ANY($2::text[]), FALSE)
          ) OVER (PARTITION BY contact.voter_id) AS successful,
          ROW_NUMBER() OVER (
            PARTITION BY contact.voter_id
            ORDER BY run.run_number DESC, contact.id DESC
          ) AS latest_position
        FROM campaign_run_contacts contact
        JOIN campaign_runs run
          ON run.id = contact.run_id
        WHERE run.iteration_id = $1
      ), latest_outcome AS (
        SELECT *
        FROM contact_history
        WHERE latest_position = 1
      )
      SELECT
        COUNT(*)::int AS unique_voters,
        COUNT(*) FILTER (WHERE successful)::int AS successful_voters,
        COUNT(*) FILTER (
          WHERE NOT successful
            AND retry_eligible = TRUE
            AND retry_exhausted = FALSE
        )::int AS retry_eligible_voters,
        COUNT(*) FILTER (
          WHERE NOT successful
            AND retry_exhausted = TRUE
        )::int AS retry_exhausted_voters,
        COUNT(*) FILTER (WHERE NOT successful)::int AS unresolved_voters
      FROM latest_outcome
    `,
    [iterationId, SUCCESS_STATUSES]
  );

  const iteration = iterationResult.rows[0];
  const runs = runsResult.rows.map((run) => ({
    ...run,
    run_number: Number(run.run_number),
    selected_contacts: Number(run.selected_contacts),
    successful_contacts: Number(run.successful_contacts),
    failed_contacts: Number(run.failed_contacts),
    retry_eligible_contacts: Number(run.retry_eligible_contacts),
    retry_exhausted_contacts: Number(run.retry_exhausted_contacts),
    pending_contacts: Number(run.pending_contacts),
    call_attempts: Number(run.call_attempts),
    callbacks_received: Number(run.callbacks_received),
    transcripts_captured: Number(run.transcripts_captured)
  }));
  const outcomes = outcomesResult.rows[0] || {};
  const openRuns = runs.filter(
    (run) => !CLOSED_RUN_STATUSES.includes(String(run.status).toUpperCase())
  );
  const lifecycleState = await loadIterationLifecycleState(client, iterationId);
  const policy = evaluateIterationLifecycle(lifecycleState);
  const protectedStatus = [iteration.program_status, iteration.link_status]
    .some((status) => ["LOCKED", "ARCHIVED", "CANCELLED"].includes(String(status || "").toUpperCase()));
  const blockers = protectedStatus
    ? ["Locked, archived or cancelled iterations cannot be completed."] : policy.blockers;

  return {
    iteration,
    runs,
    summary: {
      runCount: runs.length,
      completedRuns: runs.filter((run) =>
        CLOSED_RUN_STATUSES.includes(String(run.status).toUpperCase())
      ).length,
      openRuns: openRuns.length,
      uniqueVoters: Number(outcomes.unique_voters || 0),
      successfulVoters: Number(outcomes.successful_voters || 0),
      unresolvedVoters: Number(outcomes.unresolved_voters || 0),
      retryEligibleVoters: Number(outcomes.retry_eligible_voters || 0),
      retryExhaustedVoters: Number(outcomes.retry_exhausted_voters || 0),
      callbacksReceived: runs.reduce(
        (total, run) => total + run.callbacks_received,
        0
      ),
      transcriptsCaptured: runs.reduce(
        (total, run) => total + run.transcripts_captured,
        0
      )
    },
    readyToComplete: policy.readyToComplete && !protectedStatus,
    blockers
  };
}

export async function getIterationCloseout(iterationId, actor) {
  await assertIterationAccess(iterationId, actor);
  const db = await getDb();
  return loadCloseout(db, iterationId);
}

export async function getIterationNavigation(iterationId, actor) {
  const context = await assertIterationAccess(iterationId, actor);
  return {
    iterationId: context.id,
    campaignId: context.campaign_id || null,
    programId: context.study_id || null
  };
}

export async function completeIteration(iterationId, actor) {
  if (actor.role_code !== "CAMPAIGN_MANAGER") {
    throw errorWithStatus(
      "Only the assigned Campaign Manager can complete an iteration",
      403
    );
  }

  const context = await assertIterationAccess(iterationId, actor);
  if (context.campaign_manager_user_id !== actor.id) {
    throw errorWithStatus(
      "Campaign Manager can complete only assigned campaign iterations",
      403
    );
  }

  const db = await getDb();
  const client = await db.connect();

  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext($1))",
      [String(iterationId)]
    );
    // Prevent concurrent manager reassignment from authorizing a stale actor.
    await client.query(`
      SELECT campaign.id FROM campaigns campaign
      JOIN campaign_iteration_links link ON link.campaign_id = campaign.id
      WHERE link.iteration_id = $1 FOR UPDATE OF campaign
    `, [iterationId]);

    const lockedResult = await client.query(
      `
        SELECT link.status, link.campaign_id,
          campaign.campaign_manager_user_id
        FROM campaign_iteration_links link
        JOIN program_iterations iteration ON iteration.id = link.iteration_id
        JOIN campaigns campaign
          ON campaign.id = link.campaign_id
        WHERE link.iteration_id = $1
        FOR UPDATE OF iteration, link
      `,
      [iterationId]
    );

    if (!lockedResult.rowCount) {
      throw errorWithStatus("Campaign iteration not found", 404);
    }
    if (lockedResult.rows[0].campaign_manager_user_id !== actor.id) {
      throw errorWithStatus(
        "Campaign Manager can complete only assigned campaign iterations",
        403
      );
    }

    const closeout = await loadCloseout(client, iterationId);
    if (!closeout.readyToComplete) {
      throw errorWithStatus(closeout.blockers.join(" "), 409);
    }

    const result = await reconcileIterationLifecycle(client, iterationId, {
      source: "MANUAL_ITERATION_COMPLETION", actorId: actor.id
    });
    if (!result.iterationResolved) throw errorWithStatus(result.blockers.join(" "), 409);

    await client.query("COMMIT");
    return getIterationCloseout(iterationId, actor);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
