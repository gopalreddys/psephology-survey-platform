import { getDb } from "../db/postgres.js";
import { recordLifecycleEvent } from "./lifecycle-audit.repository.js";

const ADMIN_ROLES = new Set(["SUPER_ADMIN", "ADMIN"]);
const SUCCESS_STATUSES = [
  "SUCCESS_PULSE",
  "SUCCESS_COMPLETE",
  "SUCCESS_SUBSTANTIAL"
];
const CLOSED_ITERATION_STATUSES = ["COMPLETED", "LOCKED"];
const CLOSED_RUN_STATUSES = ["COMPLETED", "FAILED", "CANCELLED", "ARCHIVED"];

function errorWithStatus(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function number(value) {
  return Number(value || 0);
}

function percentage(value, total) {
  if (!total) return 0;
  return Number(((value / total) * 100).toFixed(1));
}

function operationalStatus(campaign) {
  const recorded = String(campaign.status || "").toUpperCase();

  if (["COMPLETED", "COMPLETE"].includes(recorded)) return "COMPLETED";
  if (recorded === "PAUSED") return "PAUSED";
  if (!number(campaign.run_count)) return "NOT_STARTED";
  if (
    number(campaign.iteration_count) > 0 &&
    number(campaign.completed_iteration_count) === number(campaign.iteration_count) &&
    number(campaign.open_run_count) === 0
  ) {
    return "READY_FOR_REVIEW";
  }
  return "IN_PROGRESS";
}

function attentionReasons(campaign) {
  const reasons = [];
  const recorded = String(campaign.status || "").toUpperCase();

  if (!campaign.campaign_manager_user_id) {
    reasons.push("Campaign Manager is not assigned.");
  }
  if (["ACTIVE", "RUNNING"].includes(recorded) && !number(campaign.iteration_count)) {
    reasons.push("Active Campaign has no Iterations.");
  }
  if (
    ["COMPLETED", "COMPLETE"].includes(recorded) &&
    number(campaign.completed_iteration_count) < number(campaign.iteration_count)
  ) {
    reasons.push("Campaign is marked completed while an Iteration remains open.");
  }
  if (number(campaign.pending_voters) > 0 && number(campaign.open_run_count) === 0) {
    reasons.push("Pending voter outcomes remain although every Run is closed.");
  }
  if (
    number(campaign.call_attempts) > number(campaign.callbacks_received) &&
    number(campaign.open_run_count) === 0
  ) {
    reasons.push("One or more provider callbacks are missing from closed Runs.");
  }

  return reasons;
}

async function loadProgram(db, programId) {
  const result = await db.query(
    `
      SELECT
        program.id,
        program.study_code,
        program.study_name,
        program.purpose,
        program.study_type,
        program.scope_mode,
        program.election_type,
        program.target_sample_size,
        program.primary_language,
        program.status,
        program.created_at,
        program.updated_at,
        jurisdiction.name AS jurisdiction_name,
        jurisdiction.code AS jurisdiction_code
      FROM survey_studies program
      LEFT JOIN jurisdictions jurisdiction
        ON jurisdiction.id = program.jurisdiction_id
      WHERE program.id = $1
      LIMIT 1
    `,
    [programId]
  );

  if (!result.rowCount) {
    throw errorWithStatus("Program not found", 404);
  }

  return result.rows[0];
}

async function loadCampaigns(db, programId) {
  const result = await db.query(
    `
      WITH campaign_set AS (
        SELECT *
        FROM campaigns
        WHERE program_id = $1
          AND status <> 'ARCHIVED'
      ), iteration_stats AS (
        SELECT
          link.campaign_id,
          COUNT(DISTINCT link.iteration_id)::int AS iteration_count,
          COUNT(DISTINCT link.iteration_id) FILTER (
            WHERE UPPER(COALESCE(link.status, iteration.status)) = ANY($2::text[])
          )::int AS completed_iteration_count,
          COUNT(DISTINCT link.iteration_id) FILTER (
            WHERE UPPER(COALESCE(link.status, iteration.status)) IN ('DRAFT', 'PLANNED')
          )::int AS not_started_iteration_count,
          COUNT(DISTINCT link.iteration_id) FILTER (
            WHERE UPPER(COALESCE(link.status, iteration.status)) = 'ACTIVE'
          )::int AS active_iteration_count,
          COUNT(DISTINCT link.iteration_id) FILTER (
            WHERE UPPER(COALESCE(link.status, iteration.status)) = 'PAUSED'
          )::int AS paused_iteration_count,
          COALESCE(SUM(iteration.target_sample_size), 0)::int AS iteration_target_contacts,
          COUNT(DISTINCT link.iteration_id) FILTER (
            WHERE iteration.questionnaire_id IS NOT NULL
          )::int AS configured_questionnaire_count
        FROM campaign_iteration_links link
        JOIN campaign_set campaign
          ON campaign.id = link.campaign_id
        JOIN program_iterations iteration
          ON iteration.id = link.iteration_id
        GROUP BY link.campaign_id
      ), run_stats AS (
        SELECT
          link.campaign_id,
          COUNT(DISTINCT run.id)::int AS run_count,
          COUNT(DISTINCT run.id) FILTER (
            WHERE UPPER(run.status) = ANY($3::text[])
          )::int AS closed_run_count,
          COUNT(DISTINCT run.id) FILTER (
            WHERE UPPER(run.status) <> ALL($3::text[])
          )::int AS open_run_count
        FROM campaign_iteration_links link
        JOIN campaign_set campaign
          ON campaign.id = link.campaign_id
        JOIN campaign_runs run
          ON run.iteration_id = link.iteration_id
        GROUP BY link.campaign_id
      ), contact_history AS (
        SELECT
          link.campaign_id,
          run.iteration_id,
          contact.voter_id,
          contact.attempt_status,
          contact.final_status,
          contact.retry_eligible,
          contact.retry_exhausted,
          BOOL_OR(contact.final_status = ANY($4::text[])) OVER (
            PARTITION BY link.campaign_id, run.iteration_id, contact.voter_id
          ) AS successful,
          ROW_NUMBER() OVER (
            PARTITION BY link.campaign_id, run.iteration_id, contact.voter_id
            ORDER BY run.run_number DESC, contact.id DESC
          ) AS latest_position
        FROM campaign_iteration_links link
        JOIN campaign_set campaign
          ON campaign.id = link.campaign_id
        JOIN campaign_runs run
          ON run.iteration_id = link.iteration_id
        JOIN campaign_run_contacts contact
          ON contact.run_id = run.id
      ), contact_stats AS (
        SELECT
          campaign_id,
          COUNT(*)::int AS selected_voters,
          COUNT(*) FILTER (WHERE successful)::int AS successful_voters,
          COUNT(*) FILTER (
            WHERE NOT successful
              AND retry_eligible = TRUE
              AND retry_exhausted = FALSE
          )::int AS retry_eligible_voters,
          COUNT(*) FILTER (
            WHERE NOT successful
              AND attempt_status NOT IN ('COMPLETED', 'FAILED')
          )::int AS pending_voters
        FROM contact_history
        WHERE latest_position = 1
        GROUP BY campaign_id
      ), execution_stats AS (
        SELECT
          link.campaign_id,
          COUNT(execution.id)::int AS call_attempts,
          COUNT(execution.id) FILTER (
            WHERE execution.callback_received_at IS NOT NULL
          )::int AS callbacks_received
        FROM campaign_iteration_links link
        JOIN campaign_set campaign
          ON campaign.id = link.campaign_id
        JOIN campaign_runs run
          ON run.iteration_id = link.iteration_id
        JOIN call_executions execution
          ON execution.run_id = run.id
        GROUP BY link.campaign_id
      ), evidence_stats AS (
        SELECT
          link.campaign_id,
          COUNT(DISTINCT (call_record.iteration_id, call_record.voter_id)) FILTER (
            WHERE LOWER(COALESCE(call_record.connectivity_status, '')) = 'connected'
          )::int AS connected_responses,
          COUNT(DISTINCT (call_record.iteration_id, call_record.voter_id)) FILTER (
            WHERE voter.is_demo_contact = TRUE
              AND LOWER(COALESCE(call_record.connectivity_status, '')) = 'connected'
          )::int AS demo_responses,
          COUNT(call_record.id) FILTER (
            WHERE CASE
              WHEN jsonb_typeof(call_record.interaction_transcript) = 'array'
                THEN jsonb_array_length(call_record.interaction_transcript) > 0
              ELSE FALSE
            END
          )::int AS transcripts_captured,
          COUNT(call_record.id) FILTER (
            WHERE jsonb_typeof(call_record.response_variables) = 'object'
              AND call_record.response_variables <> '{}'::jsonb
          )::int AS responses_captured
        FROM campaign_iteration_links link
        JOIN campaign_set campaign
          ON campaign.id = link.campaign_id
        JOIN calls call_record
          ON call_record.iteration_id = link.iteration_id
        LEFT JOIN voter_master voter
          ON voter.id = call_record.voter_id
        GROUP BY link.campaign_id
      )
      SELECT
        campaign.id,
        campaign.campaign_code,
        campaign.campaign_name,
        campaign.target_domain,
        campaign.target_type,
        campaign.target_name,
        campaign.target_code,
        campaign.survey_stage,
        campaign.status,
        campaign.start_date,
        campaign.end_date,
        campaign.campaign_manager_user_id,
        manager.full_name AS campaign_manager_name,
        COALESCE(iteration.iteration_count, 0)::int AS iteration_count,
        COALESCE(iteration.completed_iteration_count, 0)::int AS completed_iteration_count,
        COALESCE(iteration.not_started_iteration_count, 0)::int AS not_started_iteration_count,
        COALESCE(iteration.active_iteration_count, 0)::int AS active_iteration_count,
        COALESCE(iteration.paused_iteration_count, 0)::int AS paused_iteration_count,
        COALESCE(iteration.iteration_target_contacts, 0)::int AS iteration_target_contacts,
        COALESCE(iteration.configured_questionnaire_count, 0)::int AS configured_questionnaire_count,
        COALESCE(run.run_count, 0)::int AS run_count,
        COALESCE(run.closed_run_count, 0)::int AS closed_run_count,
        COALESCE(run.open_run_count, 0)::int AS open_run_count,
        COALESCE(contact.selected_voters, 0)::int AS selected_voters,
        COALESCE(contact.successful_voters, 0)::int AS successful_voters,
        COALESCE(contact.retry_eligible_voters, 0)::int AS retry_eligible_voters,
        COALESCE(contact.pending_voters, 0)::int AS pending_voters,
        COALESCE(execution.call_attempts, 0)::int AS call_attempts,
        COALESCE(execution.callbacks_received, 0)::int AS callbacks_received,
        COALESCE(evidence.connected_responses, 0)::int AS connected_responses,
        COALESCE(evidence.demo_responses, 0)::int AS demo_responses,
        COALESCE(evidence.transcripts_captured, 0)::int AS transcripts_captured,
        COALESCE(evidence.responses_captured, 0)::int AS responses_captured
      FROM campaign_set campaign
      LEFT JOIN users manager
        ON manager.id = campaign.campaign_manager_user_id
      LEFT JOIN iteration_stats iteration
        ON iteration.campaign_id = campaign.id
      LEFT JOIN run_stats run
        ON run.campaign_id = campaign.id
      LEFT JOIN contact_stats contact
        ON contact.campaign_id = campaign.id
      LEFT JOIN execution_stats execution
        ON execution.campaign_id = campaign.id
      LEFT JOIN evidence_stats evidence
        ON evidence.campaign_id = campaign.id
      ORDER BY campaign.created_at, campaign.campaign_name
    `,
    [programId, CLOSED_ITERATION_STATUSES, CLOSED_RUN_STATUSES, SUCCESS_STATUSES]
  );

  return result.rows.map((row) => {
    const selectedVoters = number(row.selected_voters);
    const successfulVoters = number(row.successful_voters);
    const reasons = attentionReasons(row);

    return {
      id: row.id,
      code: row.campaign_code,
      name: row.campaign_name,
      targetDomain: row.target_domain,
      targetType: row.target_type,
      targetName: row.target_name,
      targetCode: row.target_code,
      surveyStage: row.survey_stage,
      recordedStatus: row.status,
      operationalStatus: operationalStatus(row),
      startDate: row.start_date,
      endDate: row.end_date,
      campaignManagerId: row.campaign_manager_user_id,
      campaignManagerName: row.campaign_manager_name,
      iterationCount: number(row.iteration_count),
      completedIterationCount: number(row.completed_iteration_count),
      notStartedIterationCount: number(row.not_started_iteration_count),
      activeIterationCount: number(row.active_iteration_count),
      pausedIterationCount: number(row.paused_iteration_count),
      iterationTargetContacts: number(row.iteration_target_contacts),
      configuredQuestionnaireCount: number(row.configured_questionnaire_count),
      runCount: number(row.run_count),
      closedRunCount: number(row.closed_run_count),
      openRunCount: number(row.open_run_count),
      selectedVoters,
      successfulVoters,
      retryEligibleVoters: number(row.retry_eligible_voters),
      pendingVoters: number(row.pending_voters),
      successfulYieldPct: percentage(successfulVoters, selectedVoters),
      callAttempts: number(row.call_attempts),
      callbacksReceived: number(row.callbacks_received),
      connectedResponses: number(row.connected_responses),
      demoResponses: number(row.demo_responses),
      transcriptsCaptured: number(row.transcripts_captured),
      responsesCaptured: number(row.responses_captured),
      comparisonReady:
        number(row.completed_iteration_count) >= 2 &&
        number(row.responses_captured) > 0,
      attentionReasons: reasons,
      needsAttention: reasons.length > 0
    };
  });
}

function buildWarnings(campaigns) {
  const warnings = [];
  const missingManagers = campaigns.filter((campaign) => !campaign.campaignManagerId).length;
  const missingQuestionnaires = campaigns.reduce(
    (total, campaign) =>
      total + Math.max(campaign.iterationCount - campaign.configuredQuestionnaireCount, 0),
    0
  );
  const missingCallbacks = campaigns.reduce(
    (total, campaign) =>
      total + Math.max(campaign.callAttempts - campaign.callbacksReceived, 0),
    0
  );
  const demoResponses = campaigns.reduce(
    (total, campaign) => total + campaign.demoResponses,
    0
  );

  if (!campaigns.length) {
    warnings.push("No Campaigns have been created under this Program.");
  }
  if (missingManagers) {
    warnings.push(`${missingManagers} Campaign${missingManagers === 1 ? " has" : "s have"} no assigned Campaign Manager.`);
  }
  if (missingQuestionnaires) {
    warnings.push(`${missingQuestionnaires} Iteration${missingQuestionnaires === 1 ? " has" : "s have"} no questionnaire identity.`);
  }
  if (missingCallbacks) {
    warnings.push(`${missingCallbacks} submitted call${missingCallbacks === 1 ? " has" : "s have"} not yet produced a stored callback.`);
  }
  if (demoResponses) {
    warnings.push("Controlled demo responses are included; Program evidence is directional and not representative of the electorate.");
  }
  warnings.push("Weighting, design effects and outcome calibration are not configured; predictive claims remain disabled.");

  return warnings;
}

function buildProgramLifecycle(program, campaigns) {
  const completedCampaigns = campaigns.filter(
    (campaign) =>
      ["COMPLETE", "COMPLETED"].includes(
        String(campaign.recordedStatus || "").toUpperCase()
      )
  ).length;
  const openRuns = campaigns.reduce(
    (total, campaign) => total + number(campaign.openRunCount),
    0
  );
  const pendingVoters = campaigns.reduce(
    (total, campaign) => total + number(campaign.pendingVoters),
    0
  );
  const retryEligibleVoters = campaigns.reduce(
    (total, campaign) => total + number(campaign.retryEligibleVoters),
    0
  );
  const attentionCampaigns = campaigns.filter(
    (campaign) => campaign.needsAttention
  ).length;
  const blockers = [];

  if (!campaigns.length) blockers.push("Create at least one Campaign");
  if (completedCampaigns < campaigns.length) {
    blockers.push(`${campaigns.length - completedCampaigns} Campaign(s) are not formally completed`);
  }
  if (openRuns) blockers.push(`${openRuns} Run(s) are still open`);
  if (pendingVoters) blockers.push(`${pendingVoters} voter outcome(s) are still pending`);
  if (retryEligibleVoters) {
    blockers.push(`${retryEligibleVoters} voter(s) remain retry eligible`);
  }
  if (attentionCampaigns) {
    blockers.push(`${attentionCampaigns} Campaign(s) require operational attention`);
  }

  const recordedStatus = String(program.status || "DRAFT").toUpperCase();
  const readyToComplete =
    blockers.length === 0 &&
    ["DRAFT", "ACTIVE", "PAUSED"].includes(recordedStatus);
  let status = "NOT_STARTED";

  if (recordedStatus === "COMPLETED") status = "COMPLETED";
  else if (recordedStatus === "ARCHIVED") status = "ARCHIVED";
  else if (recordedStatus === "PAUSED") status = "PAUSED";
  else if (readyToComplete) status = "READY_FOR_REVIEW";
  else if (campaigns.length) status = "IN_PROGRESS";

  return {
    status,
    recordedStatus,
    readyToComplete,
    blockers,
    campaignCount: campaigns.length,
    completedCampaignCount: completedCampaigns,
    openRuns,
    pendingVoters,
    retryEligibleVoters,
    attentionCampaigns
  };
}

async function loadProgramLifecycleHistory(db, programId) {
  const result = await db.query(
    `
      SELECT
        event.id,
        event.entity_type,
        event.previous_status,
        event.next_status,
        event.trigger_source,
        event.created_at,
        account.full_name AS actor_name,
        COALESCE(event_campaign.campaign_name, parent_campaign.campaign_name)
          AS campaign_name
      FROM operational_lifecycle_events event
      LEFT JOIN users account ON account.id = event.actor_user_id
      LEFT JOIN campaigns event_campaign
        ON event.entity_type = 'CAMPAIGN'
       AND event_campaign.id = event.entity_id
      LEFT JOIN campaigns parent_campaign
        ON parent_campaign.id = event.parent_entity_id
      WHERE (
          event.entity_type = 'PROGRAM'
          AND event.entity_id = $1
        )
        OR event.parent_entity_id = $1
        OR event_campaign.program_id = $1
        OR parent_campaign.program_id = $1
      ORDER BY event.created_at DESC, event.entity_type, event.entity_id
      LIMIT 50
    `,
    [programId]
  );

  return result.rows;
}

export async function getProgramDashboard(programId, actor) {
  if (!ADMIN_ROLES.has(actor.role_code)) {
    throw errorWithStatus(
      "Program oversight is available only to Admin and Super Admin users",
      403
    );
  }

  const db = await getDb();
  const [program, campaigns, lifecycleHistory] = await Promise.all([
    loadProgram(db, programId),
    loadCampaigns(db, programId),
    loadProgramLifecycleHistory(db, programId)
  ]);
  const total = (key) => campaigns.reduce(
    (sum, campaign) => sum + number(campaign[key]),
    0
  );
  const countStatus = (status) => campaigns.filter(
    (campaign) => campaign.operationalStatus === status
  ).length;
  const selectedVoters = total("selectedVoters");
  const successfulVoters = total("successfulVoters");
  const completedIterations = total("completedIterationCount");
  const iterationCount = total("iterationCount");
  const lifecycle = buildProgramLifecycle(program, campaigns);

  return {
    program: {
      id: program.id,
      code: program.study_code,
      name: program.study_name,
      purpose: program.purpose,
      studyType: program.study_type,
      scopeMode: program.scope_mode,
      electionType: program.election_type,
      jurisdictionName: program.jurisdiction_name,
      jurisdictionCode: program.jurisdiction_code,
      targetSampleSize: number(program.target_sample_size),
      primaryLanguage: program.primary_language,
      status: program.status,
      createdAt: program.created_at,
      updatedAt: program.updated_at
    },
    summary: {
      campaignCount: campaigns.length,
      notStartedCampaignCount: countStatus("NOT_STARTED"),
      inProgressCampaignCount: countStatus("IN_PROGRESS"),
      pausedCampaignCount: countStatus("PAUSED"),
      readyForReviewCampaignCount: countStatus("READY_FOR_REVIEW"),
      completedCampaignCount: countStatus("COMPLETED"),
      attentionCampaignCount: campaigns.filter((campaign) => campaign.needsAttention).length,
      iterationCount,
      completedIterationCount: completedIterations,
      iterationCompletionPct: percentage(completedIterations, iterationCount),
      runCount: total("runCount"),
      closedRunCount: total("closedRunCount"),
      openRunCount: total("openRunCount"),
      selectedVoters,
      successfulVoters,
      successfulYieldPct: percentage(successfulVoters, selectedVoters),
      retryEligibleVoters: total("retryEligibleVoters"),
      pendingVoters: total("pendingVoters")
    },
    evidence: {
      callAttempts: total("callAttempts"),
      callbacksReceived: total("callbacksReceived"),
      connectedResponses: total("connectedResponses"),
      demoResponses: total("demoResponses"),
      transcriptsCaptured: total("transcriptsCaptured"),
      responsesCaptured: total("responsesCaptured"),
      comparisonReadyCampaignCount: campaigns.filter(
        (campaign) => campaign.comparisonReady
      ).length,
      representative: false,
      predictiveReady: false
    },
    campaigns,
    lifecycle: { ...lifecycle, history: lifecycleHistory },
    warnings: buildWarnings(campaigns),
    generatedAt: new Date().toISOString()
  };
}

export async function completeProgram(programId, actor) {
  if (!ADMIN_ROLES.has(actor.role_code)) {
    throw errorWithStatus(
      "Only Admin and Super Admin users can complete a Program",
      403
    );
  }

  const pool = await getDb();
  const db = await pool.connect();

  try {
    await db.query("BEGIN");
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [String(programId)]);
    const program = await loadProgram(db, programId);
    const campaigns = await loadCampaigns(db, programId);
    const lifecycle = buildProgramLifecycle(program, campaigns);

    if (String(program.status).toUpperCase() === "COMPLETED") {
      await db.query("COMMIT");
      return { programId, status: "COMPLETED", lifecycle: { ...lifecycle, status: "COMPLETED", readyToComplete: false } };
    }

    if (!lifecycle.readyToComplete) {
      throw errorWithStatus(
        `Program is not ready to complete: ${lifecycle.blockers.join("; ")}`,
        409
      );
    }

    const update = await db.query(
      `
        UPDATE survey_studies
        SET status = 'COMPLETED', updated_at = now()
        WHERE id = $1
        RETURNING id, status, updated_at
      `,
      [programId]
    );

    await recordLifecycleEvent(db, {
      entityType: "PROGRAM",
      entityId: programId,
      previousStatus: program.status,
      nextStatus: "COMPLETED",
      source: actor.role_code,
      actorId: actor.id,
      details: {
        campaignCount: lifecycle.campaignCount,
        completedCampaignCount: lifecycle.completedCampaignCount
      }
    });

    await db.query("COMMIT");
    return {
      programId,
      status: update.rows[0].status,
      updatedAt: update.rows[0].updated_at,
      lifecycle: { ...lifecycle, status: "COMPLETED", readyToComplete: false, blockers: [] }
    };
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}
