import { getDb } from "../db/postgres.js";
import { recordLifecycleEvent } from "./lifecycle-audit.repository.js";

const CLOSED_RUN_STATUSES = ["COMPLETED", "FAILED", "CANCELLED", "ARCHIVED"];

function forbidden(message) {
  const error = new Error(message);
  error.statusCode = 403;
  return error;
}

function notFound() {
  const error = new Error("Campaign not found");
  error.statusCode = 404;
  return error;
}

async function loadCampaignState(db, campaignId) {
  const campaignResult = await db.query(
    `
      SELECT
        campaign.id,
        campaign.program_id,
        campaign.campaign_name,
        campaign.status,
        campaign.campaign_manager_user_id,
        manager.full_name AS campaign_manager_name
      FROM campaigns campaign
      LEFT JOIN users manager ON manager.id = campaign.campaign_manager_user_id
      WHERE campaign.id = $1
    `,
    [campaignId]
  );

  if (!campaignResult.rowCount) throw notFound();

  const summaryResult = await db.query(
    `
      WITH iteration_run_summary AS (
        SELECT
          link.iteration_id,
          link.status,
          COUNT(DISTINCT run.run_number) FILTER (
            WHERE run.run_number BETWEEN 1 AND 3
              AND UPPER(run.status) = ANY($2::text[])
          )::int AS closed_policy_runs
        FROM campaign_iteration_links link
        LEFT JOIN campaign_runs run ON run.iteration_id = link.iteration_id
        WHERE link.campaign_id = $1
        GROUP BY link.iteration_id, link.status
      ), iteration_summary AS (
        SELECT
          COUNT(*)::int AS iterations,
          COUNT(*) FILTER (
            WHERE UPPER(status) IN ('COMPLETED', 'LOCKED')
          )::int AS completed_iterations,
          COUNT(*) FILTER (
            WHERE closed_policy_runs = 3
          )::int AS policy_complete_iterations
        FROM iteration_run_summary
      ), run_summary AS (
        SELECT
          COUNT(DISTINCT run.id)::int AS runs,
          COUNT(DISTINCT run.id) FILTER (
            WHERE UPPER(run.status) = ANY($2::text[])
          )::int AS closed_runs,
          COUNT(DISTINCT run.id) FILTER (
            WHERE UPPER(run.status) <> ALL($2::text[])
          )::int AS open_runs
        FROM campaign_iteration_links link
        JOIN campaign_runs run ON run.iteration_id = link.iteration_id
        WHERE link.campaign_id = $1
      ), contact_history AS (
        SELECT
          contact.id,
          contact.attempt_status,
          contact.retry_eligible,
          contact.retry_exhausted,
          ROW_NUMBER() OVER (
            PARTITION BY run.iteration_id, contact.voter_id
            ORDER BY run.run_number DESC, contact.id DESC
          ) AS latest_position
        FROM campaign_iteration_links link
        JOIN campaign_runs run ON run.iteration_id = link.iteration_id
        JOIN campaign_run_contacts contact ON contact.run_id = run.id
        WHERE link.campaign_id = $1
      ), contact_summary AS (
        SELECT
          COUNT(DISTINCT contact_history.id) FILTER (
            WHERE COALESCE(contact_history.attempt_status, 'PENDING')
              NOT IN ('COMPLETED', 'FAILED')
          )::int AS pending_contacts,
          COUNT(DISTINCT contact_history.id) FILTER (
            WHERE contact_history.retry_eligible = TRUE
              AND contact_history.retry_exhausted = FALSE
          )::int AS retry_eligible_contacts
        FROM contact_history
        WHERE contact_history.latest_position = 1
      ), execution_summary AS (
        SELECT
          COUNT(DISTINCT execution.id) FILTER (
            WHERE COALESCE(execution.status, 'PENDING')
              NOT IN ('COMPLETED', 'FAILED', 'CANCELLED')
          )::int AS active_executions
        FROM campaign_iteration_links link
        JOIN campaign_runs run ON run.iteration_id = link.iteration_id
        JOIN call_executions execution ON execution.run_id = run.id
        WHERE link.campaign_id = $1
      )
      SELECT
        COALESCE(iteration_summary.iterations, 0)::int AS iterations,
        COALESCE(iteration_summary.completed_iterations, 0)::int AS completed_iterations,
        COALESCE(iteration_summary.policy_complete_iterations, 0)::int AS policy_complete_iterations,
        COALESCE(run_summary.runs, 0)::int AS runs,
        COALESCE(run_summary.closed_runs, 0)::int AS closed_runs,
        COALESCE(run_summary.open_runs, 0)::int AS open_runs,
        COALESCE(contact_summary.pending_contacts, 0)::int AS pending_contacts,
        COALESCE(contact_summary.retry_eligible_contacts, 0)::int AS retry_eligible_contacts,
        COALESCE(execution_summary.active_executions, 0)::int AS active_executions
      FROM iteration_summary
      CROSS JOIN run_summary
      CROSS JOIN contact_summary
      CROSS JOIN execution_summary
    `,
    [campaignId, CLOSED_RUN_STATUSES]
  );

  const campaign = campaignResult.rows[0];
  const summary = summaryResult.rows[0];
  const blockers = [];

  if (!summary.iterations) blockers.push("Create at least one Iteration");
  if (summary.completed_iterations < summary.iterations) {
    blockers.push(`${summary.iterations - summary.completed_iterations} Iteration(s) are not complete`);
  }
  if (summary.policy_complete_iterations < summary.iterations) {
    blockers.push(`${summary.iterations - summary.policy_complete_iterations} Iteration(s) have not completed the three-Run policy`);
  }
  if (summary.open_runs) blockers.push(`${summary.open_runs} Run(s) are still open`);
  if (summary.pending_contacts) blockers.push(`${summary.pending_contacts} contact(s) are still pending`);
  if (summary.retry_eligible_contacts) {
    blockers.push(`${summary.retry_eligible_contacts} contact(s) remain retry eligible`);
  }
  if (summary.active_executions) {
    blockers.push(`${summary.active_executions} call execution(s) are awaiting a final outcome`);
  }

  const readyToComplete =
    blockers.length === 0 &&
    ["DRAFT", "ACTIVE", "PAUSED"].includes(campaign.status);
  let lifecycleStatus = "NOT_STARTED";
  if (campaign.status === "COMPLETED") lifecycleStatus = "COMPLETED";
  else if (campaign.status === "ARCHIVED") lifecycleStatus = "ARCHIVED";
  else if (campaign.status === "PAUSED") lifecycleStatus = "PAUSED";
  else if (readyToComplete) lifecycleStatus = "READY_FOR_REVIEW";
  else if (summary.runs > 0 || summary.completed_iterations > 0) lifecycleStatus = "IN_PROGRESS";

  return {
    campaign,
    lifecycleStatus,
    readyToComplete,
    blockers,
    summary
  };
}

function assertVisibility(state, actor) {
  if (["SUPER_ADMIN", "ADMIN"].includes(actor.role_code)) return;
  if (
    actor.role_code === "CAMPAIGN_MANAGER" &&
    state.campaign.campaign_manager_user_id === actor.id
  ) return;
  throw forbidden("You do not have access to this Campaign lifecycle");
}

export async function getCampaignLifecycle(campaignId, actor) {
  const db = await getDb();
  const state = await loadCampaignState(db, campaignId);
  assertVisibility(state, actor);

  const history = await db.query(
    `
      SELECT
        event.id,
        event.entity_type,
        event.entity_id,
        event.previous_status,
        event.next_status,
        event.trigger_source,
        event.details,
        event.created_at,
        account.full_name AS actor_name,
        lifecycle_run.run_number,
        COALESCE(
          run_iteration.iteration_number,
          lifecycle_iteration.iteration_number
        ) AS iteration_number,
        COALESCE(
          run_iteration.iteration_name,
          lifecycle_iteration.iteration_name
        ) AS iteration_name
      FROM operational_lifecycle_events event
      LEFT JOIN users account ON account.id = event.actor_user_id
      LEFT JOIN call_executions lifecycle_execution
        ON event.entity_type = 'CALL_EXECUTION'
       AND lifecycle_execution.id = event.entity_id
      LEFT JOIN campaign_runs lifecycle_run
        ON (
          event.entity_type = 'RUN'
          AND lifecycle_run.id = event.entity_id
        ) OR (
          event.entity_type = 'CALL_EXECUTION'
          AND lifecycle_run.id = lifecycle_execution.run_id
        )
      LEFT JOIN program_iterations run_iteration
        ON run_iteration.id = lifecycle_run.iteration_id
      LEFT JOIN program_iterations lifecycle_iteration
        ON event.entity_type = 'ITERATION'
       AND lifecycle_iteration.id = event.entity_id
      WHERE event.entity_id = $1 OR event.parent_entity_id = $1
      ORDER BY
        event.created_at DESC,
        CASE event.entity_type
          WHEN 'CAMPAIGN' THEN 1
          WHEN 'ITERATION' THEN 2
          WHEN 'RUN' THEN 3
          ELSE 4
        END,
        COALESCE(
          run_iteration.iteration_number,
          lifecycle_iteration.iteration_number,
          0
        ),
        COALESCE(lifecycle_run.run_number, 0),
        event.entity_id
      LIMIT 50
    `,
    [campaignId]
  );

  return { ...state, history: history.rows };
}

export async function completeCampaign(campaignId, actor) {
  if (actor.role_code !== "CAMPAIGN_MANAGER") {
    throw forbidden("Only the assigned Campaign Manager can complete a Campaign");
  }

  const pool = await getDb();
  const db = await pool.connect();

  try {
    await db.query("BEGIN");
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [String(campaignId)]);
    const state = await loadCampaignState(db, campaignId);
    assertVisibility(state, actor);

    if (state.campaign.status === "COMPLETED") {
      await db.query("COMMIT");
      return { ...state, lifecycleStatus: "COMPLETED", readyToComplete: false };
    }

    if (!state.readyToComplete) {
      const error = new Error(`Campaign is not ready to complete: ${state.blockers.join("; ")}`);
      error.statusCode = 409;
      throw error;
    }

    const update = await db.query(
      `
        UPDATE campaigns
        SET status = 'COMPLETED', updated_at = now()
        WHERE id = $1
        RETURNING id, status, updated_at
      `,
      [campaignId]
    );

    await recordLifecycleEvent(db, {
      entityType: "CAMPAIGN",
      entityId: campaignId,
      parentEntityId: state.campaign.program_id,
      previousStatus: state.campaign.status,
      nextStatus: "COMPLETED",
      source: "CAMPAIGN_MANAGER",
      actorId: actor.id,
      details: state.summary
    });

    await db.query("COMMIT");
    return {
      ...state,
      campaign: { ...state.campaign, ...update.rows[0] },
      lifecycleStatus: "COMPLETED",
      readyToComplete: false,
      blockers: []
    };
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}
