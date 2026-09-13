import { getDb } from "../db/postgres.js";

const ANALYSIS_ROLES = new Set([
  "SUPER_ADMIN",
  "ADMIN",
  "CAMPAIGN_MANAGER"
]);

const CLOSED_ITERATION_STATUSES = new Set([
  "COMPLETED",
  "LOCKED"
]);

const SUCCESS_STATUSES = [
  "SUCCESS_PULSE",
  "SUCCESS_COMPLETE",
  "SUCCESS_SUBSTANTIAL"
];

const TECHNICAL_VARIABLES = [
  "agent_code",
  "agent_style_context",
  "analytics_excluded",
  "attempt_cycle_id",
  "demo_call_id",
  "iteration_id",
  "iteration_number",
  "knowledge_context",
  "knowledge_packs",
  "max_probes",
  "preferred_language",
  "probe_context",
  "probe_set",
  "questionnaire_code",
  "questionnaire_context",
  "research_context",
  "run_contact_id",
  "run_id",
  "source",
  "study_id",
  "user_name",
  "voice_code",
  "voter_id",
  "voter_profession",
  "voter_qualification"
];

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

function labelFromKey(value) {
  return String(value || "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

async function loadCampaign(db, campaignId, actor) {
  if (!ANALYSIS_ROLES.has(actor.role_code)) {
    throw errorWithStatus(
      "Campaign comparative analysis is available only to Admin, Super Admin and the assigned Campaign Manager",
      403
    );
  }

  const result = await db.query(
    `
      SELECT
        campaign.id,
        campaign.campaign_code,
        campaign.campaign_name,
        campaign.program_id,
        campaign.target_domain,
        campaign.target_type,
        campaign.target_name,
        campaign.target_code,
        campaign.survey_stage,
        campaign.status,
        campaign.campaign_manager_user_id,
        manager.full_name AS campaign_manager_name,
        program.study_code AS program_code,
        program.study_name AS program_name
      FROM campaigns campaign
      LEFT JOIN users manager
        ON manager.id = campaign.campaign_manager_user_id
      LEFT JOIN survey_studies program
        ON program.id = campaign.program_id
      WHERE campaign.id = $1
      LIMIT 1
    `,
    [campaignId]
  );

  if (!result.rowCount) {
    throw errorWithStatus("Campaign not found", 404);
  }

  const campaign = result.rows[0];
  if (
    actor.role_code === "CAMPAIGN_MANAGER" &&
    campaign.campaign_manager_user_id !== actor.id
  ) {
    throw errorWithStatus(
      "Campaign Managers can compare only campaigns assigned to them",
      403
    );
  }

  return campaign;
}

async function loadIterations(db, campaignId) {
  const result = await db.query(
    `
      WITH iteration_set AS (
        SELECT
          link.campaign_id,
          link.iteration_id,
          COALESCE(link.status, iteration.status) AS effective_status
        FROM campaign_iteration_links link
        JOIN program_iterations iteration
          ON iteration.id = link.iteration_id
        WHERE link.campaign_id = $1
      ), run_stats AS (
        SELECT
          run.iteration_id,
          COUNT(DISTINCT run.id)::int AS run_count,
          COUNT(DISTINCT run.id) FILTER (
            WHERE run.status IN ('COMPLETED', 'FAILED', 'CANCELLED', 'ARCHIVED')
          )::int AS closed_run_count
        FROM campaign_runs run
        JOIN iteration_set selected
          ON selected.iteration_id = run.iteration_id
        GROUP BY run.iteration_id
      ), voter_outcomes AS (
        SELECT
          run.iteration_id,
          contact.voter_id,
          BOOL_OR(contact.final_status = ANY($2::text[])) AS successful,
          BOOL_OR(contact.retry_exhausted = TRUE) AS retry_exhausted,
          BOOL_OR(contact.attempt_status NOT IN ('COMPLETED', 'FAILED')) AS pending
        FROM campaign_run_contacts contact
        JOIN campaign_runs run
          ON run.id = contact.run_id
        JOIN iteration_set selected
          ON selected.iteration_id = run.iteration_id
        GROUP BY run.iteration_id, contact.voter_id
      ), contact_stats AS (
        SELECT
          iteration_id,
          COUNT(*)::int AS selected_voters,
          COUNT(*) FILTER (WHERE successful)::int AS successful_voters,
          COUNT(*) FILTER (
            WHERE NOT successful AND retry_exhausted
          )::int AS retry_exhausted_voters,
          COUNT(*) FILTER (WHERE pending)::int AS pending_voters
        FROM voter_outcomes
        GROUP BY iteration_id
      ), execution_stats AS (
        SELECT
          run.iteration_id,
          COUNT(execution.id)::int AS call_attempts,
          COUNT(execution.id) FILTER (
            WHERE execution.callback_received_at IS NOT NULL
          )::int AS callbacks_received
        FROM call_executions execution
        JOIN campaign_runs run
          ON run.id = execution.run_id
        JOIN iteration_set selected
          ON selected.iteration_id = run.iteration_id
        GROUP BY run.iteration_id
      ), call_stats AS (
        SELECT
          call_record.iteration_id,
          COUNT(DISTINCT call_record.voter_id) FILTER (
            WHERE LOWER(COALESCE(call_record.connectivity_status, '')) = 'connected'
          )::int AS connected_respondents,
          COUNT(DISTINCT call_record.voter_id) FILTER (
            WHERE voter.is_demo_contact = TRUE
              AND LOWER(COALESCE(call_record.connectivity_status, '')) = 'connected'
          )::int AS demo_respondents,
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
          )::int AS responses_captured,
          ROUND(AVG(call_record.duration_seconds) FILTER (
            WHERE LOWER(COALESCE(call_record.connectivity_status, '')) = 'connected'
          )::numeric, 1) AS average_duration_seconds
        FROM calls call_record
        JOIN iteration_set selected
          ON selected.iteration_id = call_record.iteration_id
        LEFT JOIN voter_master voter
          ON voter.id = call_record.voter_id
        GROUP BY call_record.iteration_id
      )
      SELECT
        iteration.id,
        iteration.iteration_number,
        iteration.iteration_name,
        iteration.research_phase,
        iteration.target_sample_size,
        iteration.questionnaire_id,
        questionnaire.code AS questionnaire_code,
        questionnaire.name AS questionnaire_name,
        questionnaire.status AS questionnaire_status,
        selected.effective_status AS status,
        iteration.created_at,
        iteration.updated_at,
        COALESCE(run_stat.run_count, 0)::int AS run_count,
        COALESCE(run_stat.closed_run_count, 0)::int AS closed_run_count,
        COALESCE(contact.selected_voters, 0)::int AS selected_voters,
        COALESCE(contact.successful_voters, 0)::int AS successful_voters,
        COALESCE(contact.retry_exhausted_voters, 0)::int AS retry_exhausted_voters,
        COALESCE(contact.pending_voters, 0)::int AS pending_voters,
        COALESCE(execution.call_attempts, 0)::int AS call_attempts,
        COALESCE(execution.callbacks_received, 0)::int AS callbacks_received,
        COALESCE(call_stat.connected_respondents, 0)::int AS connected_respondents,
        COALESCE(call_stat.demo_respondents, 0)::int AS demo_respondents,
        COALESCE(call_stat.transcripts_captured, 0)::int AS transcripts_captured,
        COALESCE(call_stat.responses_captured, 0)::int AS responses_captured,
        COALESCE(call_stat.average_duration_seconds, 0)::numeric AS average_duration_seconds
      FROM iteration_set selected
      JOIN program_iterations iteration
        ON iteration.id = selected.iteration_id
      LEFT JOIN questionnaires questionnaire
        ON questionnaire.id = iteration.questionnaire_id
      LEFT JOIN run_stats run_stat
        ON run_stat.iteration_id = iteration.id
      LEFT JOIN contact_stats contact
        ON contact.iteration_id = iteration.id
      LEFT JOIN execution_stats execution
        ON execution.iteration_id = iteration.id
      LEFT JOIN call_stats call_stat
        ON call_stat.iteration_id = iteration.id
      ORDER BY iteration.iteration_number, iteration.created_at
    `,
    [campaignId, SUCCESS_STATUSES]
  );

  return result.rows.map((row) => {
    const target = number(row.target_sample_size);
    const successful = number(row.successful_voters);

    return {
      id: row.id,
      number: number(row.iteration_number),
      name: row.iteration_name,
      researchPhase: row.research_phase,
      status: row.status,
      completed: CLOSED_ITERATION_STATUSES.has(
        String(row.status || "").toUpperCase()
      ),
      targetSample: target,
      questionnaireId: row.questionnaire_id,
      questionnaireCode: row.questionnaire_code,
      questionnaireName: row.questionnaire_name,
      questionnaireStatus: row.questionnaire_status,
      runCount: number(row.run_count),
      closedRunCount: number(row.closed_run_count),
      selectedVoters: number(row.selected_voters),
      successfulVoters: successful,
      retryExhaustedVoters: number(row.retry_exhausted_voters),
      pendingVoters: number(row.pending_voters),
      callAttempts: number(row.call_attempts),
      callbacksReceived: number(row.callbacks_received),
      connectedRespondents: number(row.connected_respondents),
      demoRespondents: number(row.demo_respondents),
      transcriptsCaptured: number(row.transcripts_captured),
      responsesCaptured: number(row.responses_captured),
      averageDurationSeconds: number(row.average_duration_seconds),
      successfulCoveragePct: percentage(successful, target),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  });
}

async function loadResponseDistributions(db, iterationIds) {
  if (iterationIds.length < 2) return [];

  const result = await db.query(
    `
      SELECT
        call_record.iteration_id,
        LOWER(TRIM(response.key)) AS response_key,
        LOWER(TRIM(response.value)) AS response_value,
        COUNT(DISTINCT call_record.voter_id)::int AS respondents
      FROM calls call_record
      CROSS JOIN LATERAL jsonb_each_text(
        CASE
          WHEN jsonb_typeof(call_record.response_variables) = 'object'
            THEN call_record.response_variables
          ELSE '{}'::jsonb
        END
      ) response
      WHERE call_record.iteration_id = ANY($1::uuid[])
        AND LOWER(COALESCE(call_record.connectivity_status, '')) = 'connected'
        AND LOWER(TRIM(response.key)) <> ALL($2::text[])
        AND response.value IS NOT NULL
        AND LENGTH(TRIM(response.value)) > 0
      GROUP BY
        call_record.iteration_id,
        LOWER(TRIM(response.key)),
        LOWER(TRIM(response.value))
      ORDER BY response_key, call_record.iteration_id, respondents DESC
    `,
    [iterationIds, TECHNICAL_VARIABLES]
  );

  const questions = new Map();

  for (const row of result.rows) {
    if (!questions.has(row.response_key)) {
      questions.set(row.response_key, new Map());
    }

    const iterationMap = questions.get(row.response_key);
    if (!iterationMap.has(row.iteration_id)) {
      iterationMap.set(row.iteration_id, []);
    }

    iterationMap.get(row.iteration_id).push({
      value: row.response_value,
      respondents: number(row.respondents)
    });
  }

  const [previousIterationId, latestIterationId] = iterationIds;
  const items = [];

  for (const [key, iterationMap] of questions.entries()) {
    const rawValues = Array.from(iterationMap.values()).flat();
    const distinctValueCount = new Set(
      rawValues.map((value) => value.value)
    ).size;
    const longestValueLength = rawValues.reduce(
      (maximum, value) => Math.max(maximum, String(value.value).length),
      0
    );
    const structuredCategory =
      distinctValueCount <= 20 && longestValueLength <= 80;
    const iterations = iterationIds.map((iterationId) => {
      const values = iterationMap.get(iterationId) || [];
      const totalRespondents = values.reduce(
        (total, value) => total + value.respondents,
        0
      );

      return {
        iterationId,
        totalRespondents,
        values: values.slice(0, 12).map((value) => ({
          ...value,
          percentage: percentage(value.respondents, totalRespondents)
        }))
      };
    });

    const previous = iterations.find(
      (iteration) => iteration.iterationId === previousIterationId
    );
    const latest = iterations.find(
      (iteration) => iteration.iterationId === latestIterationId
    );
    const comparable = Boolean(
      structuredCategory &&
      previous?.totalRespondents &&
      latest?.totalRespondents
    );
    const values = new Set([
      ...(previous?.values || []).map((value) => value.value),
      ...(latest?.values || []).map((value) => value.value)
    ]);
    const movements = Array.from(values).map((value) => {
      const previousValue = previous?.values.find(
        (item) => item.value === value
      );
      const latestValue = latest?.values.find(
        (item) => item.value === value
      );

      return {
        value,
        previousPercentage: previousValue?.percentage || 0,
        latestPercentage: latestValue?.percentage || 0,
        shiftPercentagePoints: Number(
          (
            (latestValue?.percentage || 0) -
            (previousValue?.percentage || 0)
          ).toFixed(1)
        )
      };
    });
    const largestShift = movements.sort(
      (left, right) =>
        Math.abs(right.shiftPercentagePoints) -
        Math.abs(left.shiftPercentagePoints)
    )[0] || null;

    items.push({
      key,
      label: labelFromKey(key),
      comparable,
      structuredCategory,
      suppressionReason: structuredCategory
        ? null
        : "Free-text or high-cardinality values are not converted into percentage movement.",
      distinctValueCount,
      iterations,
      largestShift,
      maximumRespondents: Math.max(
        ...iterations.map((iteration) => iteration.totalRespondents),
        0
      )
    });
  }

  return items
    .sort((left, right) => {
      if (left.comparable !== right.comparable) {
        return left.comparable ? -1 : 1;
      }
      return right.maximumRespondents - left.maximumRespondents ||
        left.label.localeCompare(right.label);
    })
    .slice(0, 40);
}

async function loadRespondentOverlap(db, previousIterationId, latestIterationId) {
  if (!previousIterationId || !latestIterationId) return 0;

  const result = await db.query(
    `
      SELECT COUNT(*)::int AS overlapping_respondents
      FROM (
        SELECT DISTINCT voter_id
        FROM calls
        WHERE iteration_id = $1
          AND voter_id IS NOT NULL
          AND LOWER(COALESCE(connectivity_status, '')) = 'connected'
        INTERSECT
        SELECT DISTINCT voter_id
        FROM calls
        WHERE iteration_id = $2
          AND voter_id IS NOT NULL
          AND LOWER(COALESCE(connectivity_status, '')) = 'connected'
      ) overlap
    `,
    [previousIterationId, latestIterationId]
  );

  return number(result.rows[0]?.overlapping_respondents);
}

function buildReadiness(completed, questions, overlap) {
  const comparison = completed.slice(-2);
  const [previous, latest] = comparison;
  const comparableQuestionCount = questions.filter(
    (question) => question.comparable
  ).length;
  const questionnairesConfigured = Boolean(
    previous?.questionnaireId && latest?.questionnaireId
  );
  const questionnaireCompatible = Boolean(
    questionnairesConfigured &&
    previous.questionnaireId === latest.questionnaireId
  );
  const minimumBase = Math.min(
    previous?.connectedRespondents || 0,
    latest?.connectedRespondents || 0
  );
  const demoRespondents = Math.max(
    previous?.demoRespondents || 0,
    latest?.demoRespondents || 0
  );
  const ready = comparison.length === 2 && comparableQuestionCount > 0;
  const warnings = [];

  if (comparison.length < 2) {
    warnings.push("At least two completed Iterations are required for comparison.");
  }
  if (!questionnairesConfigured && comparison.length === 2) {
    warnings.push("One or both Iterations do not have a questionnaire identity snapshot.");
  } else if (comparison.length === 2 && !questionnaireCompatible) {
    warnings.push("The two Iterations use different questionnaires; compare only shared normalized response variables.");
  }
  if (comparison.length === 2 && comparableQuestionCount === 0) {
    warnings.push("No shared structured response variables were captured across both Iterations.");
  }
  if (demoRespondents > 0) {
    warnings.push("Controlled demo contacts are present. Results are directional demonstrations, not electorate estimates.");
  }
  if (comparison.length === 2 && minimumBase < 30) {
    warnings.push("The comparable respondent base is below 30; suppress statistical inference and predictive claims.");
  }
  if (overlap > 0) {
    warnings.push("Some respondents appear in both Iterations. Treat movement as recontact/panel evidence, not independent cross-sections.");
  }
  warnings.push("Weighting, design effects, confidence intervals and outcome calibration are not yet configured.");

  let researchDesign = "NOT_ESTABLISHED";
  if (comparison.length === 2) {
    const smallerBase = Math.min(
      previous.connectedRespondents,
      latest.connectedRespondents
    );
    researchDesign = overlap === 0
      ? "REPEATED_CROSS_SECTION"
      : smallerBase > 0 && overlap >= smallerBase
        ? "PANEL_RECONTACT"
        : "MIXED_RECONTACT";
  }

  return {
    ready,
    analysisMode: !ready
      ? "NOT_READY"
      : demoRespondents > 0
        ? "DEMO_DIRECTIONAL"
        : "UNWEIGHTED_DIRECTIONAL",
    representative: false,
    predictiveReady: false,
    questionnaireCompatible,
    comparableQuestionCount,
    minimumRespondentBase: minimumBase,
    demoRespondents,
    overlappingRespondents: overlap,
    researchDesign,
    warnings
  };
}

export async function getCampaignAnalysis(campaignId, actor) {
  const db = await getDb();
  const campaign = await loadCampaign(db, campaignId, actor);
  const iterations = await loadIterations(db, campaignId);
  const completed = iterations.filter((iteration) => iteration.completed);
  const comparisonIterations = completed.slice(-2);
  const comparisonIds = comparisonIterations.map((iteration) => iteration.id);
  const [questions, overlap] = await Promise.all([
    loadResponseDistributions(db, comparisonIds),
    loadRespondentOverlap(db, comparisonIds[0], comparisonIds[1])
  ]);
  const readiness = buildReadiness(completed, questions, overlap);
  const sentimentSignals = questions.filter((question) =>
    /(sentiment|mood|approval|satisfaction|feeling|confidence|optimism|anger|trust)/i.test(
      question.key
    )
  ).map((question) => question.key);

  return {
    campaign: {
      id: campaign.id,
      code: campaign.campaign_code,
      name: campaign.campaign_name,
      programId: campaign.program_id,
      programCode: campaign.program_code,
      programName: campaign.program_name,
      targetDomain: campaign.target_domain,
      targetType: campaign.target_type,
      targetName: campaign.target_name,
      targetCode: campaign.target_code,
      surveyStage: campaign.survey_stage,
      status: campaign.status,
      campaignManagerName: campaign.campaign_manager_name
    },
    summary: {
      iterationCount: iterations.length,
      completedIterationCount: completed.length,
      comparisonIterationCount: comparisonIterations.length,
      comparableQuestionCount: readiness.comparableQuestionCount,
      sentimentSignalCount: sentimentSignals.length
    },
    readiness,
    iterations,
    comparison: comparisonIterations.length === 2
      ? {
          previousIteration: comparisonIterations[0],
          latestIteration: comparisonIterations[1],
          questions,
          sentimentSignals
        }
      : null,
    generatedAt: new Date().toISOString()
  };
}
