import { getDb } from "../db/postgres.js";
import { campaignReviewVisibilitySql } from "./campaign-visibility.repository.js";

const ROLES = new Set(["SUPER_ADMIN", "ADMIN", "CAMPAIGN_MANAGER", "CAMPAIGNER"]);
const CLOSED_RUNS = new Set(["COMPLETED", "FAILED", "CANCELLED", "ARCHIVED"]);

function campaignScope(actor) {
  if (actor.role_code === "CAMPAIGNER") {
    return {
      sql: `EXISTS (
        SELECT 1 FROM campaign_work_allocations permitted
        WHERE permitted.campaign_id = campaign.id
          AND permitted.campaigner_user_id = $1
          AND permitted.status <> 'REASSIGNED'
      )`,
      values: [actor.id]
    };
  }
  return campaignReviewVisibilitySql(actor, "campaign", 1);
}

function iterationScope(actor) {
  if (actor.role_code !== "CAMPAIGNER") return "TRUE";
  return `EXISTS (
    SELECT 1 FROM campaign_work_allocations permitted
    WHERE permitted.campaign_id = campaign.id
      AND (permitted.iteration_id = iteration.id OR permitted.iteration_id IS NULL)
      AND permitted.campaigner_user_id = $1
      AND permitted.status <> 'REASSIGNED'
  )`;
}

function count(value) {
  return Number(value || 0);
}

function action(kind, priority, title, detail, href, campaignName = null) {
  return { kind, priority, title, detail, href, campaignName };
}

function sortActions(items) {
  return items.sort((left, right) =>
    right.priority - left.priority || left.title.localeCompare(right.title)
  ).slice(0, 12);
}

function buildDashboard(actor, campaignRows, iterationRows, runRows) {
  const campaigns = campaignRows.map((row) => ({
    id: row.id,
    name: row.campaign_name,
    code: row.campaign_code,
    status: row.status,
    managerAssigned: Boolean(row.campaign_manager_user_id),
    updatedAt: row.updated_at,
    iterations: []
  }));
  const campaignById = new Map(campaigns.map((campaign) => [campaign.id, campaign]));
  const iterations = iterationRows.map((row) => {
    const item = {
      id: row.id,
      campaignId: row.campaign_id,
      number: count(row.iteration_number),
      name: row.iteration_name,
      status: row.status,
      questionnaireConfigured: Boolean(row.questionnaire_id),
      voiceAgentConfigured: Boolean(row.voice_agent_id),
      runs: []
    };
    campaignById.get(item.campaignId)?.iterations.push(item);
    return item;
  });
  const iterationById = new Map(iterations.map((iteration) => [iteration.id, iteration]));
  const runs = runRows.map((row) => {
    const item = {
      id: row.id,
      iterationId: row.iteration_id,
      number: count(row.run_number),
      name: row.run_name || `Run ${row.run_number}`,
      status: row.status,
      pendingContacts: count(row.pending_contacts),
      retryEligibleContacts: count(row.retry_eligible_contacts),
      callAttempts: count(row.call_attempts),
      awaitingCallbacks: count(row.awaiting_callbacks),
      staleCallbacks: count(row.stale_callbacks),
      connectedCalls: count(row.connected_calls),
      missingTranscripts: count(row.missing_transcripts),
      missingResponses: count(row.missing_responses),
      updatedAt: row.updated_at
    };
    iterationById.get(item.iterationId)?.runs.push(item);
    return item;
  });

  const completedIterations = iterations.filter((iteration) =>
    ["COMPLETED", "LOCKED"].includes(String(iteration.status).toUpperCase()) ||
    (iteration.runs.length >= 3 && iteration.runs.every((run) => CLOSED_RUNS.has(run.status)))
  );
  const summary = {
    campaignsVisible: campaigns.length,
    campaignsCompleted: campaigns.filter((campaign) => campaign.status === "COMPLETED").length,
    campaignsWithoutManager: campaigns.filter((campaign) =>
      !campaign.managerAssigned && campaign.status !== "COMPLETED"
    ).length,
    iterationsVisible: iterations.length,
    iterationsCompleted: completedIterations.length,
    runsReady: runs.filter((run) => run.status === "READY").length,
    runsRunning: runs.filter((run) => run.status === "RUNNING").length,
    runsClosed: runs.filter((run) => CLOSED_RUNS.has(run.status)).length,
    pendingContacts: runs.reduce((total, run) => total + run.pendingContacts, 0),
    retryEligibleContacts: runs.reduce((total, run) => total + run.retryEligibleContacts, 0),
    callAttempts: runs.reduce((total, run) => total + run.callAttempts, 0),
    awaitingCallbacks: runs.reduce((total, run) => total + run.awaitingCallbacks, 0),
    staleCallbacks: runs.reduce((total, run) => total + run.staleCallbacks, 0),
    connectedCalls: runs.reduce((total, run) => total + run.connectedCalls, 0),
    missingTranscripts: runs.reduce((total, run) => total + run.missingTranscripts, 0),
    missingResponses: runs.reduce((total, run) => total + run.missingResponses, 0)
  };

  const actions = [];
  for (const campaign of campaigns) {
    if (["SUPER_ADMIN", "ADMIN"].includes(actor.role_code) &&
        !campaign.managerAssigned && campaign.status !== "COMPLETED") {
      actions.push(action(
        "ASSIGN_MANAGER", 90, "Assign a Campaign Manager",
        `${campaign.name} cannot move into managed operations until it has an owner.`,
        `/campaigns/${campaign.id}`, campaign.name
      ));
    }
    if (actor.role_code === "CAMPAIGN_MANAGER" && campaign.status === "ACTIVE" &&
        campaign.iterations.length > 0 &&
        campaign.iterations.every((iteration) => completedIterations.includes(iteration))) {
      actions.push(action(
        "REVIEW_CAMPAIGN", 65, "Review completed Campaign",
        `${campaign.name} has no open Iterations. Review its analysis and lifecycle before closeout.`,
        `/campaigns/${campaign.id}`, campaign.name
      ));
    }
    if (!campaign.iterations.length && actor.role_code !== "CAMPAIGNER" &&
        campaign.status !== "COMPLETED") {
      actions.push(action(
        "CREATE_ITERATION", 35, "Plan the first Iteration",
        `${campaign.name} has no research Iteration yet.`,
        `/campaigns/${campaign.id}`, campaign.name
      ));
    }
  }
  for (const iteration of iterations) {
    const campaign = campaignById.get(iteration.campaignId);
    const label = `${campaign?.name || "Campaign"} · Iteration ${iteration.number}`;
    const completed = completedIterations.includes(iteration);
    if (!completed && actor.role_code !== "CAMPAIGNER" &&
        (!iteration.questionnaireConfigured || !iteration.voiceAgentConfigured)) {
      actions.push(action(
        "CONFIGURE_ITERATION", 70, "Complete Iteration configuration",
        `${label} is missing ${[
          !iteration.questionnaireConfigured && "questionnaire",
          !iteration.voiceAgentConfigured && "voice agent"
        ].filter(Boolean).join(" and ")}.`,
        `/iterations/${iteration.id}`, campaign?.name
      ));
    }
    for (const run of iteration.runs) {
      if (run.staleCallbacks > 0) {
        actions.push(action(
          "STALE_CALLBACKS", 100, "Review delayed callbacks",
          `${label} · Run ${run.number} has ${run.staleCallbacks} call${run.staleCallbacks === 1 ? "" : "s"} awaiting callbacks beyond 30 minutes.`,
          "/calls", campaign?.name
        ));
      }
      if (!completed && run.status === "READY" && run.pendingContacts > 0 &&
          actor.role_code === "CAMPAIGNER") {
        actions.push(action(
          "REVIEW_RUN", 80, "Review ready Run",
          `${label} · Run ${run.number} has ${run.pendingContacts} pending contact${run.pendingContacts === 1 ? "" : "s"}. Confirm recipients before launching.`,
          `/iterations/${iteration.id}`, campaign?.name
        ));
      }
      if (!completed && run.retryEligibleContacts > 0 &&
          run.number === Math.max(...iteration.runs.map((candidate) => candidate.number)) &&
          actor.role_code === "CAMPAIGNER") {
        actions.push(action(
          "RETRY_CONTACTS", 60, "Review retry-eligible contacts",
          `${label} · Run ${run.number} has ${run.retryEligibleContacts} contact${run.retryEligibleContacts === 1 ? "" : "s"} eligible for retry.`,
          `/iterations/${iteration.id}`, campaign?.name
        ));
      }
      if (run.missingTranscripts > 0 && actor.role_code !== "CAMPAIGNER") {
        actions.push(action(
          "EVIDENCE_GAP", 55, "Inspect transcript gaps",
          `${label} · Run ${run.number} has ${run.missingTranscripts} connected call${run.missingTranscripts === 1 ? "" : "s"} without a transcript.`,
          "/calls", campaign?.name
        ));
      }
      if (run.missingResponses > 0 && actor.role_code !== "CAMPAIGNER") {
        actions.push(action(
          "EVIDENCE_GAP", 50, "Inspect structured-response gaps",
          `${label} · Run ${run.number} has ${run.missingResponses} connected call${run.missingResponses === 1 ? "" : "s"} without recorded response variables.`,
          "/calls", campaign?.name
        ));
      }
    }
  }

  return {
    role: actor.role_code,
    summary,
    actions: sortActions(actions),
    campaigns: campaigns
      .sort((left, right) => new Date(right.updatedAt) - new Date(left.updatedAt))
      .slice(0, 8)
      .map((campaign) => ({
        ...campaign,
        iterationCount: campaign.iterations.length,
        completedIterationCount: campaign.iterations.filter((iteration) =>
          completedIterations.includes(iteration)
        ).length,
        activeRunCount: campaign.iterations.reduce((total, iteration) =>
          total + iteration.runs.filter((run) =>
            ["READY", "RUNNING"].includes(run.status)
          ).length,
          0
        ),
        iterations: campaign.iterations
          .sort((left, right) => left.number - right.number)
          .map((iteration) => ({
            id: iteration.id,
            number: iteration.number,
            name: iteration.name,
            status: iteration.status,
            runCount: iteration.runs.length,
            readyRunCount: iteration.runs.filter((run) => run.status === "READY").length,
            runningRunCount: iteration.runs.filter((run) => run.status === "RUNNING").length
          }))
      })),
    generatedAt: new Date().toISOString()
  };
}

export async function getRoleDashboard(actor) {
  if (!ROLES.has(actor.role_code)) {
    const error = new Error("Role is not permitted to view the Dashboard");
    error.statusCode = 403;
    throw error;
  }
  const db = await getDb();
  const scope = campaignScope(actor);
  const selectedIterationScope = iterationScope(actor);

  const campaignsPromise = db.query(`
    SELECT campaign.id, campaign.campaign_code, campaign.campaign_name,
      campaign.status, campaign.campaign_manager_user_id, campaign.updated_at
    FROM campaigns campaign
    WHERE campaign.status <> 'ARCHIVED' AND ${scope.sql}
    ORDER BY campaign.updated_at DESC
  `, scope.values);

  const iterationsPromise = db.query(`
    SELECT iteration.id, link.campaign_id, iteration.iteration_number,
      iteration.iteration_name, COALESCE(link.status, iteration.status) AS status,
      iteration.questionnaire_id, iteration.voice_agent_id
    FROM campaign_iteration_links link
    JOIN campaigns campaign ON campaign.id = link.campaign_id
    JOIN program_iterations iteration ON iteration.id = link.iteration_id
    WHERE campaign.status <> 'ARCHIVED' AND ${scope.sql}
      AND ${selectedIterationScope}
    ORDER BY iteration.iteration_number, iteration.created_at
  `, scope.values);

  const runsPromise = db.query(`
    WITH scoped_iterations AS (
      SELECT DISTINCT iteration.id
      FROM campaign_iteration_links link
      JOIN campaigns campaign ON campaign.id = link.campaign_id
      JOIN program_iterations iteration ON iteration.id = link.iteration_id
      WHERE campaign.status <> 'ARCHIVED' AND ${scope.sql}
        AND ${selectedIterationScope}
    ), contact_stats AS (
      SELECT contact.run_id,
        COUNT(*) FILTER (WHERE contact.attempt_status = 'PENDING')::int AS pending_contacts,
        COUNT(*) FILTER (WHERE contact.retry_eligible = TRUE
          AND contact.retry_exhausted = FALSE)::int AS retry_eligible_contacts
      FROM campaign_run_contacts contact
      JOIN campaign_runs selected_run ON selected_run.id = contact.run_id
      JOIN scoped_iterations scoped ON scoped.id = selected_run.iteration_id
      GROUP BY contact.run_id
    ), execution_stats AS (
      SELECT execution.run_id,
        COUNT(*)::int AS call_attempts,
        COUNT(*) FILTER (WHERE execution.callback_received_at IS NULL
          AND execution.status IN ('PENDING', 'SUBMITTED', 'RUNNING'))::int AS awaiting_callbacks,
        COUNT(*) FILTER (WHERE execution.callback_received_at IS NULL
          AND execution.status IN ('PENDING', 'SUBMITTED', 'RUNNING')
          AND COALESCE(execution.submitted_at, execution.created_at)
            < now() - interval '30 minutes')::int AS stale_callbacks
      FROM call_executions execution
      JOIN campaign_runs selected_run ON selected_run.id = execution.run_id
      JOIN scoped_iterations scoped ON scoped.id = selected_run.iteration_id
      GROUP BY execution.run_id
    ), evidence_stats AS (
      SELECT call_record.run_id,
        COUNT(*) FILTER (WHERE LOWER(COALESCE(call_record.connectivity_status, '')) = 'connected')::int AS connected_calls,
        COUNT(*) FILTER (WHERE LOWER(COALESCE(call_record.connectivity_status, '')) = 'connected'
          AND CASE WHEN jsonb_typeof(call_record.interaction_transcript) = 'array'
            THEN jsonb_array_length(call_record.interaction_transcript) = 0
            ELSE TRUE END)::int AS missing_transcripts,
        COUNT(*) FILTER (WHERE LOWER(COALESCE(call_record.connectivity_status, '')) = 'connected'
          AND (jsonb_typeof(call_record.response_variables) <> 'object'
            OR call_record.response_variables = '{}'::jsonb))::int AS missing_responses
      FROM calls call_record
      JOIN campaign_runs selected_run ON selected_run.id = call_record.run_id
      JOIN scoped_iterations scoped ON scoped.id = selected_run.iteration_id
      GROUP BY call_record.run_id
    )
    SELECT run.id, run.iteration_id, run.run_number, run.run_name,
      run.status, run.updated_at,
      COALESCE(contact.pending_contacts, 0)::int AS pending_contacts,
      COALESCE(contact.retry_eligible_contacts, 0)::int AS retry_eligible_contacts,
      COALESCE(execution.call_attempts, 0)::int AS call_attempts,
      COALESCE(execution.awaiting_callbacks, 0)::int AS awaiting_callbacks,
      COALESCE(execution.stale_callbacks, 0)::int AS stale_callbacks,
      COALESCE(evidence.connected_calls, 0)::int AS connected_calls,
      COALESCE(evidence.missing_transcripts, 0)::int AS missing_transcripts,
      COALESCE(evidence.missing_responses, 0)::int AS missing_responses
    FROM campaign_runs run
    JOIN scoped_iterations scoped ON scoped.id = run.iteration_id
    LEFT JOIN contact_stats contact ON contact.run_id = run.id
    LEFT JOIN execution_stats execution ON execution.run_id = run.id
    LEFT JOIN evidence_stats evidence ON evidence.run_id = run.id
    ORDER BY run.updated_at DESC
  `, scope.values);

  const [campaigns, iterations, runs] = await Promise.all([
    campaignsPromise,
    iterationsPromise,
    runsPromise
  ]);
  return buildDashboard(actor, campaigns.rows, iterations.rows, runs.rows);
}
