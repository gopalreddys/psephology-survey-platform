import { getDb } from "../db/postgres.js";
import { campaignReviewVisibilitySql } from "./campaign-visibility.repository.js";

const ANALYTICS_ROLES = new Set([
  "SUPER_ADMIN",
  "ADMIN",
  "CAMPAIGN_MANAGER"
]);

const CLOSED_RUN_STATUSES = [
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "ARCHIVED"
];

const CLOSED_ITERATION_STATUSES = [
  "COMPLETED",
  "LOCKED"
];

const SUCCESS_STATUSES = [
  "SUCCESS_PULSE",
  "SUCCESS_COMPLETE",
  "SUCCESS_SUBSTANTIAL"
];

function number(value) {
  return Number(value || 0);
}

function percentage(value, total) {
  if (!total) return 0;
  return Number(((number(value) / number(total)) * 100).toFixed(1));
}

function errorWithStatus(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function mapIteration(row) {
  const selectedVoters = number(row.selected_voters);
  const successfulVoters = number(row.successful_voters);
  const attempts = number(row.call_attempts);
  const callbacks = number(row.callbacks_received);
  const connected = number(row.connected_calls);
  const transcripts = number(row.transcripts_captured);
  const responses = number(row.responses_captured);
  const runCount = number(row.run_count);
  const closedRunCount = number(row.closed_run_count);
  const completed = CLOSED_ITERATION_STATUSES.includes(
    String(row.iteration_status || "").toUpperCase()
  ) || (runCount > 0 && closedRunCount === runCount);

  return {
    id: row.iteration_id,
    number: number(row.iteration_number),
    name: row.iteration_name,
    researchPhase: row.research_phase,
    status: row.iteration_status,
    completed,
    targetSample: number(row.target_sample_size),
    questionnaire: row.questionnaire_id ? {
      id: row.questionnaire_id,
      code: row.questionnaire_code,
      name: row.questionnaire_name
    } : null,
    runCount,
    closedRunCount,
    selectedVoters,
    successfulVoters,
    retryExhaustedVoters: number(row.retry_exhausted_voters),
    pendingVoters: number(row.pending_voters),
    callAttempts: attempts,
    callbacksReceived: callbacks,
    connectedCalls: connected,
    transcriptsCaptured: transcripts,
    responsesCaptured: responses,
    averageDurationSeconds: number(row.average_duration_seconds),
    successfulCoveragePct: percentage(successfulVoters, selectedVoters),
    callbackCoveragePct: percentage(callbacks, attempts),
    transcriptCoveragePct: percentage(transcripts, connected),
    responseCoveragePct: percentage(responses, connected),
    latestAttemptAt: row.latest_attempt_at
  };
}

function sum(items, key) {
  return items.reduce((total, item) => total + number(item[key]), 0);
}

function campaignSummary(campaign, iterations) {
  const selectedVoters = sum(iterations, "selectedVoters");
  const successfulVoters = sum(iterations, "successfulVoters");
  const attempts = sum(iterations, "callAttempts");
  const callbacks = sum(iterations, "callbacksReceived");
  const connected = sum(iterations, "connectedCalls");
  const transcripts = sum(iterations, "transcriptsCaptured");
  const responses = sum(iterations, "responsesCaptured");

  return {
    id: campaign.id,
    code: campaign.campaign_code,
    name: campaign.campaign_name,
    status: campaign.status,
    surveyStage: campaign.survey_stage,
    targetType: campaign.target_type,
    targetName: campaign.target_name,
    targetCode: campaign.target_code,
    programName: campaign.program_name,
    campaignManagerName: campaign.campaign_manager_name,
    iterationCount: iterations.length,
    completedIterationCount: iterations.filter((item) => item.completed).length,
    runCount: sum(iterations, "runCount"),
    closedRunCount: sum(iterations, "closedRunCount"),
    selectedVoters,
    successfulVoters,
    callAttempts: attempts,
    callbacksReceived: callbacks,
    connectedCalls: connected,
    transcriptsCaptured: transcripts,
    responsesCaptured: responses,
    successfulCoveragePct: percentage(successfulVoters, selectedVoters),
    callbackCoveragePct: percentage(callbacks, attempts),
    transcriptCoveragePct: percentage(transcripts, connected),
    responseCoveragePct: percentage(responses, connected),
    iterations
  };
}

export async function getAnalyticsWorkspace(actor) {
  if (!ANALYTICS_ROLES.has(actor.role_code)) {
    throw errorWithStatus(
      "Analytics is available only to Admin, Super Admin and Campaign Manager roles",
      403
    );
  }

  const db = await getDb();
  const scope = campaignReviewVisibilitySql(actor, "campaign", 1);

  const campaignsPromise = db.query(`
    SELECT campaign.id, campaign.campaign_code, campaign.campaign_name,
      campaign.status, campaign.survey_stage, campaign.target_type,
      campaign.target_name, campaign.target_code,
      program.study_name AS program_name,
      manager.full_name AS campaign_manager_name
    FROM campaigns campaign
    LEFT JOIN survey_studies program ON program.id = campaign.program_id
    LEFT JOIN users manager ON manager.id = campaign.campaign_manager_user_id
    WHERE campaign.status <> 'ARCHIVED' AND ${scope.sql}
    ORDER BY campaign.updated_at DESC, campaign.campaign_name
  `, scope.values);

  const iterationsPromise = db.query(`
    WITH accessible_campaigns AS (
      SELECT campaign.id
      FROM campaigns campaign
      WHERE campaign.status <> 'ARCHIVED' AND ${scope.sql}
    ), iteration_set AS (
      SELECT DISTINCT link.campaign_id, link.iteration_id,
        COALESCE(link.status, iteration.status) AS iteration_status
      FROM campaign_iteration_links link
      JOIN accessible_campaigns campaign ON campaign.id = link.campaign_id
      JOIN program_iterations iteration ON iteration.id = link.iteration_id
    ), run_stats AS (
      SELECT selected.campaign_id, run.iteration_id,
        COUNT(DISTINCT run.id)::int AS run_count,
        COUNT(DISTINCT run.id) FILTER (
          WHERE run.status = ANY($${scope.values.length + 1}::text[])
        )::int AS closed_run_count
      FROM iteration_set selected
      JOIN campaign_runs run ON run.iteration_id = selected.iteration_id
      GROUP BY selected.campaign_id, run.iteration_id
    ), contact_outcomes AS (
      SELECT selected.campaign_id, run.iteration_id, contact.voter_id,
        BOOL_OR(contact.final_status = ANY($${scope.values.length + 2}::text[])) AS successful,
        BOOL_OR(contact.retry_exhausted = TRUE) AS retry_exhausted,
        BOOL_OR(contact.attempt_status NOT IN ('COMPLETED', 'FAILED')) AS pending
      FROM iteration_set selected
      JOIN campaign_runs run ON run.iteration_id = selected.iteration_id
      JOIN campaign_run_contacts contact ON contact.run_id = run.id
      GROUP BY selected.campaign_id, run.iteration_id, contact.voter_id
    ), contact_stats AS (
      SELECT campaign_id, iteration_id,
        COUNT(*)::int AS selected_voters,
        COUNT(*) FILTER (WHERE successful)::int AS successful_voters,
        COUNT(*) FILTER (WHERE NOT successful AND retry_exhausted)::int AS retry_exhausted_voters,
        COUNT(*) FILTER (WHERE pending)::int AS pending_voters
      FROM contact_outcomes
      GROUP BY campaign_id, iteration_id
    ), execution_stats AS (
      SELECT selected.campaign_id, run.iteration_id,
        COUNT(execution.id)::int AS call_attempts,
        COUNT(execution.id) FILTER (
          WHERE execution.callback_received_at IS NOT NULL
        )::int AS callbacks_received,
        MAX(execution.created_at) AS latest_attempt_at
      FROM iteration_set selected
      JOIN campaign_runs run ON run.iteration_id = selected.iteration_id
      LEFT JOIN call_executions execution ON execution.run_id = run.id
      GROUP BY selected.campaign_id, run.iteration_id
    ), call_stats AS (
      SELECT selected.campaign_id, selected.iteration_id,
        COUNT(call_record.id) FILTER (
          WHERE LOWER(COALESCE(call_record.connectivity_status, '')) = 'connected'
        )::int AS connected_calls,
        COUNT(call_record.id) FILTER (
          WHERE jsonb_typeof(call_record.interaction_transcript) = 'array'
            AND jsonb_array_length(call_record.interaction_transcript) > 0
        )::int AS transcripts_captured,
        COUNT(call_record.id) FILTER (
          WHERE jsonb_typeof(call_record.response_variables) = 'object'
            AND call_record.response_variables <> '{}'::jsonb
        )::int AS responses_captured,
        ROUND(AVG(call_record.duration_seconds) FILTER (
          WHERE LOWER(COALESCE(call_record.connectivity_status, '')) = 'connected'
        )::numeric, 1) AS average_duration_seconds
      FROM iteration_set selected
      LEFT JOIN calls call_record ON call_record.iteration_id = selected.iteration_id
      GROUP BY selected.campaign_id, selected.iteration_id
    )
    SELECT selected.campaign_id,
      iteration.id AS iteration_id, iteration.iteration_number,
      iteration.iteration_name, iteration.research_phase,
      selected.iteration_status, iteration.target_sample_size,
      iteration.questionnaire_id, questionnaire.questionnaire_code,
      questionnaire.questionnaire_name,
      COALESCE(run_stat.run_count, 0)::int AS run_count,
      COALESCE(run_stat.closed_run_count, 0)::int AS closed_run_count,
      COALESCE(contact.selected_voters, 0)::int AS selected_voters,
      COALESCE(contact.successful_voters, 0)::int AS successful_voters,
      COALESCE(contact.retry_exhausted_voters, 0)::int AS retry_exhausted_voters,
      COALESCE(contact.pending_voters, 0)::int AS pending_voters,
      COALESCE(execution.call_attempts, 0)::int AS call_attempts,
      COALESCE(execution.callbacks_received, 0)::int AS callbacks_received,
      COALESCE(call_stat.connected_calls, 0)::int AS connected_calls,
      COALESCE(call_stat.transcripts_captured, 0)::int AS transcripts_captured,
      COALESCE(call_stat.responses_captured, 0)::int AS responses_captured,
      COALESCE(call_stat.average_duration_seconds, 0)::numeric AS average_duration_seconds,
      execution.latest_attempt_at
    FROM iteration_set selected
    JOIN program_iterations iteration ON iteration.id = selected.iteration_id
    LEFT JOIN questionnaires questionnaire ON questionnaire.id = iteration.questionnaire_id
    LEFT JOIN run_stats run_stat
      ON run_stat.campaign_id = selected.campaign_id
      AND run_stat.iteration_id = selected.iteration_id
    LEFT JOIN contact_stats contact
      ON contact.campaign_id = selected.campaign_id
      AND contact.iteration_id = selected.iteration_id
    LEFT JOIN execution_stats execution
      ON execution.campaign_id = selected.campaign_id
      AND execution.iteration_id = selected.iteration_id
    LEFT JOIN call_stats call_stat
      ON call_stat.campaign_id = selected.campaign_id
      AND call_stat.iteration_id = selected.iteration_id
    ORDER BY selected.campaign_id, iteration.iteration_number, iteration.created_at
  `, [...scope.values, CLOSED_RUN_STATUSES, SUCCESS_STATUSES]);

  const [campaignResult, iterationResult] = await Promise.all([
    campaignsPromise,
    iterationsPromise
  ]);

  const mappedIterations = iterationResult.rows.map((row) => ({
    campaignId: row.campaign_id,
    analytics: mapIteration(row)
  }));
  const campaigns = campaignResult.rows.map((campaign) => campaignSummary(
    campaign,
    mappedIterations
      .filter((iteration) => iteration.campaignId === campaign.id)
      .map((iteration) => iteration.analytics)
  ));

  const allIterations = campaigns.flatMap((campaign) => campaign.iterations);
  const selectedVoters = sum(allIterations, "selectedVoters");
  const successfulVoters = sum(allIterations, "successfulVoters");
  const attempts = sum(allIterations, "callAttempts");
  const callbacks = sum(allIterations, "callbacksReceived");
  const connected = sum(allIterations, "connectedCalls");
  const transcripts = sum(allIterations, "transcriptsCaptured");
  const responses = sum(allIterations, "responsesCaptured");

  return {
    summary: {
      campaignCount: campaigns.length,
      completedCampaignCount: campaigns.filter((item) => item.status === "COMPLETED").length,
      iterationCount: allIterations.length,
      completedIterationCount: allIterations.filter((item) => item.completed).length,
      runCount: sum(allIterations, "runCount"),
      closedRunCount: sum(allIterations, "closedRunCount"),
      selectedVoters,
      successfulVoters,
      callAttempts: attempts,
      callbacksReceived: callbacks,
      connectedCalls: connected,
      transcriptsCaptured: transcripts,
      responsesCaptured: responses,
      successfulCoveragePct: percentage(successfulVoters, selectedVoters),
      callbackCoveragePct: percentage(callbacks, attempts),
      transcriptCoveragePct: percentage(transcripts, connected),
      responseCoveragePct: percentage(responses, connected)
    },
    campaigns,
    generatedAt: new Date().toISOString()
  };
}
