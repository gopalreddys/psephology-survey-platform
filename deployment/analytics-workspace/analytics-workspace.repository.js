import { getDb } from "../db/postgres.js";
import { campaignReviewVisibilitySql } from "./campaign-visibility.repository.js";
import { getCampaignAnalysis } from "./campaign-analysis.repository.js";

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

const MINIMUM_SEGMENT_BASE = 5;
const AGE_BANDS = ["18–29", "30–39", "40–49", "50+", "Unknown"];

const TECHNICAL_VARIABLES = new Set([
  "agent_code", "agent_style_context", "analytics_excluded", "attempt_cycle_id",
  "demo_call_id", "iteration_id", "iteration_number", "knowledge_context",
  "knowledge_packs", "max_probes", "preferred_language", "probe_context",
  "probe_set", "questionnaire_code", "questionnaire_context", "research_context",
  "run_contact_id", "run_id", "source", "study_id", "user_name", "voice_code",
  "voter_id", "voter_profession", "voter_qualification"
]);

const MLC_QUESTION_CATALOG = [
  { code: "Q_GRADUATE_ISSUE_PRIORITY", label: "Graduate issue priority", section: "ISSUES", required: true, keys: ["graduate_issue_priority", "issue_sentiment"] },
  { code: "Q_MLC_ROLE_AWARENESS", label: "MLC role awareness", section: "INSTITUTION", required: true, keys: ["mlc_role_awareness"] },
  { code: "Q_INCUMBENT_AWARENESS", label: "Incumbent awareness", section: "INSTITUTION", required: true, keys: ["incumbent_awareness"] },
  { code: "Q_INCUMBENT_ASSESSMENT", label: "Incumbent assessment", section: "INSTITUTION", required: false, keys: ["incumbent_assessment"] },
  { code: "Q_CANDIDATE_CRITERION", label: "Preferred candidate quality", section: "CANDIDATE", required: true, keys: ["candidate_criterion"] },
  { code: "Q_ASSOCIATION_INFLUENCE", label: "Association influence", section: "GROUPS", required: false, keys: ["association_influence", "association_named"] },
  { code: "Q_PARTY_SALIENCE_UNAIDED", label: "Unaided party salience", section: "PARTIES", required: true, keys: ["party_salience_unaided", "party_salience_reason"] },
  { code: "Q_GROUP_ISSUE_LEADER_AIDED", label: "Perceived issue leader", section: "PARTIES", required: true, keys: ["perceived_issue_leader_aided"] },
  { code: "Q_VEERESH_AWARENESS", label: "Veeresh awareness", section: "CANDIDATE", required: true, keys: ["veeresh_awareness", "veeresh_impression"] },
  { code: "Q_VEERESH_CRITERION_FIT", label: "Veeresh criterion fit", section: "CANDIDATE", required: false, keys: ["veeresh_criterion_fit"] }
];

const TRANSCRIPT_THEMES = [
  { key: "EMPLOYMENT", label: "Employment and jobs", pattern: /job|employment|unemploy|recruit|career|ఉద్యోగ/gi },
  { key: "EDUCATION", label: "Education and universities", pattern: /education|college|university|student|teacher|fee|scholarship|విద్య/gi },
  { key: "GRADUATE_REPRESENTATION", label: "Graduate representation", pattern: /graduate|mlc|represent|constituency|పట్టభద్ర/gi },
  { key: "CANDIDATE", label: "Candidate awareness", pattern: /veeresh|kasani|వీరేశ్/gi },
  { key: "PARTY", label: "Party landscape", pattern: /\bbrs\b|\bbjp\b|congress|communist|left part|political party/gi },
  { key: "ASSOCIATIONS", label: "Associations and unions", pattern: /association|union|student wing|teacher wing|graduate group|సంఘ/gi },
  { key: "CIVIC_SERVICES", label: "Civic services", pattern: /road|water|transport|municipal|infrastructure|traffic/gi }
];

function number(value) {
  return Number(value || 0);
}

function percentage(value, total) {
  if (!total) return 0;
  return Number(((number(value) / number(total)) * 100).toFixed(1));
}

function normalizeGender(value) {
  const text = scalarText(value).toLowerCase();
  if (/^(f|female|woman)$/.test(text)) return "Female";
  if (/^(m|male|man)$/.test(text)) return "Male";
  if (!text) return "Unknown";
  return "Other / self-described";
}

function ageBand(value) {
  const age = Number(value);
  if (!Number.isFinite(age) || age < 18) return "Unknown";
  if (age < 30) return "18–29";
  if (age < 40) return "30–39";
  if (age < 50) return "40–49";
  return "50+";
}

function normalizeMandal(value) {
  return scalarText(value) || "Unknown";
}

function filterOptions(records) {
  return {
    genders: Array.from(new Set(records.map((record) => normalizeGender(record.gender)))).sort(),
    ageBands: AGE_BANDS.filter((band) => records.some((record) => ageBand(record.age) === band)),
    mandals: Array.from(new Set(records.map((record) => normalizeMandal(record.mandal_name)))).sort()
  };
}

function filterRespondents(records, selection) {
  return records.filter((record) => {
    if (selection.gender && normalizeGender(record.gender) !== selection.gender) return false;
    if (selection.ageBand && ageBand(record.age) !== selection.ageBand) return false;
    if (selection.mandal && normalizeMandal(record.mandal_name) !== selection.mandal) return false;
    return true;
  });
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

function labelFromKey(value) {
  return String(value || "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function scalarText(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (["number", "boolean"].includes(typeof value)) return String(value);
  if (Array.isArray(value)) return value.map(scalarText).filter(Boolean).join(", ");
  return "";
}

function validAnswer(value) {
  const text = scalarText(value);
  return Boolean(text && !/^(null|undefined|n\/a)$/i.test(text));
}

function distribution(records, key, classifier = null) {
  const values = new Map();
  for (const record of records) {
    const raw = scalarText(record.response_variables?.[key]);
    if (!raw) continue;
    const display = classifier ? classifier(raw) : raw;
    if (!display) continue;
    const normalized = display.toLowerCase();
    const current = values.get(normalized) || { value: display, respondents: 0 };
    current.respondents += 1;
    values.set(normalized, current);
  }
  const answered = Array.from(values.values()).reduce(
    (total, item) => total + item.respondents,
    0
  );
  return Array.from(values.values())
    .sort((left, right) => right.respondents - left.respondents || left.value.localeCompare(right.value))
    .slice(0, 12)
    .map((item) => ({
      ...item,
      percentage: percentage(item.respondents, answered)
    }));
}

function derivedDistribution(records, derive) {
  const values = new Map();
  for (const record of records) {
    const display = derive(record);
    if (!display) continue;
    const normalized = display.toLowerCase();
    const current = values.get(normalized) || { value: display, respondents: 0 };
    current.respondents += 1;
    values.set(normalized, current);
  }
  const answered = Array.from(values.values()).reduce(
    (total, item) => total + item.respondents,
    0
  );
  return Array.from(values.values())
    .sort((left, right) => right.respondents - left.respondents || left.value.localeCompare(right.value))
    .map((item) => ({
      ...item,
      percentage: percentage(item.respondents, answered)
    }));
}

function firstAvailableDistribution(records, keys, classifier = null) {
  for (const key of keys) {
    const result = distribution(records, key, classifier);
    if (result.length) return result;
  }
  return [];
}

function directFivePointIndex(records) {
  const keys = ["brs_lean_rating", "party_lean_rating", "party_lean_strength"];
  const ratings = [];
  for (const record of records) {
    const variables = record.response_variables || {};
    for (const key of keys) {
      const value = Number(variables[key]);
      if (Number.isFinite(value) && value >= 1 && value <= 5) {
        ratings.push(value);
        break;
      }
    }
  }
  return {
    value: ratings.length
      ? Number((ratings.reduce((total, value) => total + value, 0) / ratings.length).toFixed(1))
      : null,
    answered: ratings.length,
    scale: 5,
    basis: "Direct respondent rating only"
  };
}

function classifySentiment(value) {
  const text = scalarText(value).toLowerCase();
  if (!text) return null;
  if (/not enough|don.?t know|do not know|can.?t say|cannot say|no opinion|not aware|not heard|unaware|prefer not|unclear|unknown/.test(text)) {
    return "Can't say";
  }
  if (/very poor|poor|negative|bad|dissatisf|disappoint|not good|unfavour|unfavor|weak/.test(text)) {
    return "Negative";
  }
  if (/neither|neutral|mixed|average|no difference|okay|moderate/.test(text)) {
    return "Neutral";
  }
  if (/very good|good|positive|favour|favor|satisf|impress|excellent|strong/.test(text)) {
    return "Positive";
  }
  return "Can't say";
}

function classifyFit(value) {
  const text = scalarText(value).toLowerCase();
  if (!text) return null;
  if (/very closely|somewhat closely|strong fit|good fit/.test(text)) return "Positive";
  if (/not very closely|not at all|poor fit/.test(text)) return "Negative";
  if (/neutral|mixed|average/.test(text)) return "Neutral";
  return "Can't say";
}

function candidateSentiment(record) {
  const variables = record.response_variables || {};
  if (validAnswer(variables.veeresh_impression)) {
    return classifySentiment(variables.veeresh_impression);
  }
  if (validAnswer(variables.veeresh_criterion_fit)) {
    return classifyFit(variables.veeresh_criterion_fit);
  }
  if (validAnswer(variables.veeresh_awareness)) {
    return "Can't say";
  }
  return null;
}

function classifyParty(value) {
  const text = scalarText(value).toLowerCase();
  if (!text) return null;
  if (/\bbrs\b|bharat rashtra|telangana rashtra/.test(text)) return "BRS";
  if (/\bbjp\b|bharatiya janata/.test(text)) return "BJP";
  if (/congress|\binc\b/.test(text)) return "Congress";
  if (/communist|\bcpi\b|\bcpm\b|left part/.test(text)) return "Left parties";
  if (/independent|graduate group/.test(text)) return "Independent or graduate group";
  if (/none|not enough|don.?t know|do not know|no idea|prefer not/.test(text)) return "None / can't say";
  return "Other";
}

function classifyInfluence(value) {
  const text = scalarText(value).toLowerCase();
  if (!text) return null;
  if (/not enough|don.?t know|do not know|not sure|prefer not|unclear/.test(text)) return "Can't say";
  if (/\bno\b|none|not influenc|did not|hasn.?t|haven.?t/.test(text)) return "No influence stated";
  if (/\byes\b|influenc|shaped|association|union|student|teacher|graduate group/.test(text)) return "Influence stated";
  return "Can't say";
}

function shareOf(items, label) {
  return number(items.find((item) => item.value === label)?.percentage);
}

function buildIterationDashboard(records, {
  issuePriority,
  partySalience,
  issueLeader,
  incumbentAssessment,
  associationInfluence,
  averageAnswerCoveragePct,
  demoRespondents
}) {
  const candidateSentimentDistribution = derivedDistribution(records, candidateSentiment);
  const issueSentiment = distribution(records, "issue_sentiment", classifySentiment);
  const incumbentSentiment = derivedDistribution(records, (record) =>
    classifySentiment(record.response_variables?.incumbent_assessment)
  );
  const associationInfluenceSignal = derivedDistribution(records, (record) =>
    classifyInfluence(record.response_variables?.association_influence)
  );
  const fitSentiment = derivedDistribution(records, (record) =>
    classifyFit(record.response_variables?.veeresh_criterion_fit)
  );
  const topIssue = issuePriority[0] || null;
  const topParty = partySalience[0] || null;
  const topIssueLeader = issueLeader[0] || null;
  const respondentBase = records.length;
  const reasons = [];

  if (respondentBase < 100) reasons.push("A minimum analytical base has not been reached.");
  if (demoRespondents > 0) reasons.push("The evidence includes controlled demo respondents.");
  reasons.push("The questionnaire does not measure a verified vote-choice outcome.");
  reasons.push("No sampling weights or out-of-sample validation are available.");

  return {
    respondentBase,
    candidateSentiment: candidateSentimentDistribution,
    candidateFit: fitSentiment,
    issueSentiment,
    incumbentSentiment: incumbentSentiment.length ? incumbentSentiment : incumbentAssessment,
    partyAttention: partySalience,
    perceivedIssueLeadership: issueLeader,
    associationInfluence: associationInfluenceSignal.length
      ? associationInfluenceSignal
      : associationInfluence,
    headlineMetrics: [
      {
        label: "Candidate positive",
        value: shareOf(candidateSentimentDistribution, "Positive"),
        detail: "Positive share of classified candidate perception answers"
      },
      {
        label: "Candidate can't say",
        value: shareOf(candidateSentimentDistribution, "Can't say"),
        detail: "Insufficient candidate knowledge or no classifiable view"
      },
      {
        label: "Association influence",
        value: shareOf(associationInfluenceSignal, "Influence stated"),
        detail: "Respondents explicitly reporting group influence"
      },
      {
        label: "Answer completeness",
        value: averageAnswerCoveragePct,
        detail: "Average coverage across answered questionnaire variables"
      }
    ],
    leadingSignals: {
      issue: topIssue,
      partyAttention: topParty,
      issueLeader: topIssueLeader
    },
    predictiveAssessment: {
      status: "NOT_READY",
      label: "Descriptive and directional only",
      reasons,
      permittedUse: "Compare aggregate Iteration signals and improve questionnaire design.",
      prohibitedUse: "Do not infer individual vote choice, persuasion likelihood or constituency vote share."
    }
  };
}

function latestRespondents(records, iterationId, runId = null) {
  const respondents = new Map();
  for (const record of records) {
    if (record.iteration_id !== iterationId) continue;
    if (runId && record.run_id !== runId) continue;
    const key = record.voter_id || record.call_id;
    if (!respondents.has(key)) respondents.set(key, record);
  }
  return Array.from(respondents.values());
}

function questionnaireCatalog(records) {
  const keys = new Set();
  for (const record of records) {
    for (const key of Object.keys(record.response_variables || {})) {
      const normalized = key.toLowerCase().trim();
      if (!TECHNICAL_VARIABLES.has(normalized)) keys.add(normalized);
    }
  }
  const mlc = MLC_QUESTION_CATALOG.some((question) =>
    question.keys.some((key) => keys.has(key))
  );
  if (mlc) return MLC_QUESTION_CATALOG;
  return Array.from(keys).sort().map((key) => ({
    code: key.toUpperCase(),
    label: labelFromKey(key),
    section: "RECORDED OUTPUTS",
    required: false,
    keys: [key]
  }));
}

function questionPerformance(records) {
  const catalog = questionnaireCatalog(records);
  return catalog.map((question) => {
    const answeredRecords = records.filter((record) =>
      question.keys.some((key) => validAnswer(record.response_variables?.[key]))
    );
    const primaryKey = question.keys.find((key) =>
      records.some((record) => validAnswer(record.response_variables?.[key]))
    ) || question.keys[0];
    const values = distribution(records, primaryKey);
    const highCardinality = values.length > 8 || values.some((item) => item.value.length > 80);
    return {
      code: question.code,
      label: question.label,
      section: question.section,
      required: question.required,
      outputVariables: question.keys,
      answered: answeredRecords.length,
      missing: Math.max(records.length - answeredRecords.length, 0),
      answeredPct: percentage(answeredRecords.length, records.length),
      structured: !highCardinality,
      distribution: highCardinality ? [] : values,
      qualitativeAnswers: highCardinality
        ? values.slice(0, 5).map((item) => item.value)
        : []
    };
  });
}

function classifyIssue(value) {
  const text = value.toLowerCase();
  if (/job|employment|unemploy|recruit|career|ఉద్యోగ/.test(text)) return "Employment and jobs";
  if (/education|college|university|student|teacher|fee|scholarship|విద్య/.test(text)) return "Education and universities";
  if (/skill|training|internship/.test(text)) return "Skills and professional development";
  if (/represent|voice|access|available|leadership/.test(text)) return "Representation and accessibility";
  if (/road|water|transport|traffic|infrastructure/.test(text)) return "Civic services and infrastructure";
  if (/not sure|don't know|do not know|none|no idea/.test(text)) return "No stated priority";
  return "Other or uncoded issue";
}

function classifyAwareness(value) {
  const text = value.toLowerCase();
  if (/not heard|never heard|don't know|do not know|unaware|not familiar|nothing|no idea/.test(text)) {
    return "Not previously aware";
  }
  if (/\byes\b|heard|know|aware|familiar|work|leader|candidate/.test(text)) {
    return "Previously aware";
  }
  return "Unclear or qualitative awareness";
}

function transcriptText(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(transcriptText).filter(Boolean).join(" ");
  if (typeof value === "object") {
    for (const key of ["text", "content", "message", "utterance", "transcript"]) {
      if (typeof value[key] === "string") return value[key];
    }
    return Object.values(value).map(transcriptText).filter(Boolean).join(" ");
  }
  return "";
}

function safeSnippet(text, index) {
  const start = Math.max(index - 90, 0);
  const end = Math.min(index + 170, text.length);
  return text.slice(start, end)
    .replace(/\s+/g, " ")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email redacted]")
    .replace(/\+?\d[\d\s-]{7,}\d/g, "[number redacted]")
    .trim();
}

function transcriptThemes(records) {
  return TRANSCRIPT_THEMES.map((theme) => {
    const evidence = [];
    let mentions = 0;
    for (const record of records) {
      const text = transcriptText(record.interaction_transcript);
      if (!text) continue;
      const matches = text.match(theme.pattern) || [];
      if (!matches.length) continue;
      mentions += matches.length;
      if (evidence.length < 3) {
        evidence.push({
          executionId: record.execution_id,
          iterationId: record.iteration_id,
          iterationNumber: number(record.iteration_number),
          snippet: safeSnippet(text, text.search(theme.pattern))
        });
      }
    }
    return {
      key: theme.key,
      label: theme.label,
      respondents: records.filter((record) =>
        Boolean(transcriptText(record.interaction_transcript).match(theme.pattern))
      ).length,
      mentions,
      evidence
    };
  }).filter((theme) => theme.respondents > 0)
    .sort((left, right) => right.respondents - left.respondents || right.mentions - left.mentions);
}

function strategicFindings(issuePriority, candidateAwareness, issueLeader, performance, respondentBase) {
  const findings = [];
  const topIssue = issuePriority[0];
  const awareness = candidateAwareness.find((item) => item.value === "Previously aware");
  const topLeader = issueLeader[0];
  const weakQuestion = [...performance].sort((left, right) => left.answeredPct - right.answeredPct)[0];

  if (topIssue) findings.push({
    type: "ISSUE",
    title: `${topIssue.value} leads the recorded issue priorities`,
    evidence: `${topIssue.respondents} respondents · ${topIssue.percentage}% of coded issue answers`,
    caution: "Open-text classification is directional and should be reviewed against transcript evidence."
  });
  if (awareness) findings.push({
    type: "CANDIDATE",
    title: `${awareness.percentage}% show some prior candidate awareness`,
    evidence: `${awareness.respondents} of ${candidateAwareness.reduce((total, item) => total + item.respondents, 0)} classified awareness answers`,
    caution: "Awareness does not imply positive support or vote intention."
  });
  if (topLeader) findings.push({
    type: "PARTY",
    title: `${topLeader.value} is the most frequently recorded aided issue leader`,
    evidence: `${topLeader.respondents} respondents · ${topLeader.percentage}% of answered records`,
    caution: "This is perceived issue leadership, not a vote-choice measure."
  });
  if (weakQuestion && weakQuestion.answeredPct < 80) findings.push({
    type: "QUALITY",
    title: `${weakQuestion.label} has the largest answer gap`,
    evidence: `${weakQuestion.answered}/${respondentBase} respondents answered · ${weakQuestion.answeredPct}%`,
    caution: "Review question wording, conditional logic and agent probing before the next Iteration."
  });
  return findings;
}

async function loadStrategicEvidence(db, iterationIds) {
  if (!iterationIds.length) return [];
  const result = await db.query(`
    SELECT call_record.id AS call_id, call_record.attempt_id,
      execution.id AS execution_id, call_record.iteration_id,
      iteration.iteration_number, iteration.iteration_name,
      call_record.run_id, selected_run.run_number, selected_run.run_name,
      call_record.voter_id, voter.is_demo_contact, voter.gender, voter.age,
      voter.mandal_name_source AS mandal_name,
      call_record.response_variables, call_record.interaction_transcript,
      call_record.duration_seconds, call_record.updated_at
    FROM calls call_record
    JOIN program_iterations iteration ON iteration.id = call_record.iteration_id
    LEFT JOIN campaign_runs selected_run ON selected_run.id = call_record.run_id
    LEFT JOIN voter_master voter ON voter.id = call_record.voter_id
    LEFT JOIN LATERAL (
      SELECT candidate.id
      FROM call_executions candidate
      WHERE candidate.provider_attempt_id = call_record.attempt_id
      ORDER BY candidate.updated_at DESC NULLS LAST
      LIMIT 1
    ) execution ON TRUE
    WHERE call_record.iteration_id = ANY($1::uuid[])
      AND LOWER(COALESCE(call_record.connectivity_status, '')) = 'connected'
    ORDER BY call_record.updated_at DESC NULLS LAST
  `, [iterationIds]);
  return result.rows;
}

async function loadRunCatalog(db, iterationIds) {
  if (!iterationIds.length) return [];
  const result = await db.query(`
    WITH contact_stats AS (
      SELECT contact.run_id,
        COUNT(DISTINCT contact.voter_id)::int AS selected_voters,
        COUNT(DISTINCT contact.voter_id) FILTER (
          WHERE contact.final_status = ANY($2::text[])
        )::int AS successful_voters,
        COUNT(DISTINCT contact.voter_id) FILTER (
          WHERE contact.retry_eligible = TRUE AND contact.retry_exhausted = FALSE
        )::int AS retry_eligible_voters
      FROM campaign_run_contacts contact
      JOIN campaign_runs run ON run.id = contact.run_id
      WHERE run.iteration_id = ANY($1::uuid[])
      GROUP BY contact.run_id
    ), execution_stats AS (
      SELECT execution.run_id,
        COUNT(*)::int AS call_attempts,
        COUNT(*) FILTER (WHERE execution.callback_received_at IS NOT NULL)::int AS callbacks_received
      FROM call_executions execution
      JOIN campaign_runs run ON run.id = execution.run_id
      WHERE run.iteration_id = ANY($1::uuid[])
      GROUP BY execution.run_id
    ), evidence_stats AS (
      SELECT call_record.run_id,
        COUNT(*) FILTER (
          WHERE LOWER(COALESCE(call_record.connectivity_status, '')) = 'connected'
        )::int AS connected_calls,
        COUNT(*) FILTER (
          WHERE LOWER(COALESCE(call_record.connectivity_status, '')) = 'connected'
            AND jsonb_typeof(call_record.interaction_transcript) = 'array'
            AND jsonb_array_length(call_record.interaction_transcript) > 0
        )::int AS transcripts_captured,
        COUNT(*) FILTER (
          WHERE LOWER(COALESCE(call_record.connectivity_status, '')) = 'connected'
            AND jsonb_typeof(call_record.response_variables) = 'object'
            AND call_record.response_variables <> '{}'::jsonb
        )::int AS responses_captured,
        ROUND(AVG(call_record.duration_seconds) FILTER (
          WHERE LOWER(COALESCE(call_record.connectivity_status, '')) = 'connected'
        )::numeric, 1) AS average_duration_seconds
      FROM calls call_record
      JOIN campaign_runs run ON run.id = call_record.run_id
      WHERE run.iteration_id = ANY($1::uuid[])
      GROUP BY call_record.run_id
    )
    SELECT run.id, run.iteration_id, run.run_number, run.run_name, run.status,
      COALESCE(contact.selected_voters, 0)::int AS selected_voters,
      COALESCE(contact.successful_voters, 0)::int AS successful_voters,
      COALESCE(contact.retry_eligible_voters, 0)::int AS retry_eligible_voters,
      COALESCE(execution.call_attempts, 0)::int AS call_attempts,
      COALESCE(execution.callbacks_received, 0)::int AS callbacks_received,
      COALESCE(evidence.connected_calls, 0)::int AS connected_calls,
      COALESCE(evidence.transcripts_captured, 0)::int AS transcripts_captured,
      COALESCE(evidence.responses_captured, 0)::int AS responses_captured,
      COALESCE(evidence.average_duration_seconds, 0)::numeric AS average_duration_seconds
    FROM campaign_runs run
    LEFT JOIN contact_stats contact ON contact.run_id = run.id
    LEFT JOIN execution_stats execution ON execution.run_id = run.id
    LEFT JOIN evidence_stats evidence ON evidence.run_id = run.id
    WHERE run.iteration_id = ANY($1::uuid[])
    ORDER BY run.iteration_id, run.run_number, run.created_at
  `, [iterationIds, SUCCESS_STATUSES]);
  return result.rows.map((row) => ({
    id: row.id,
    iterationId: row.iteration_id,
    number: number(row.run_number),
    name: row.run_name || `Run ${row.run_number}`,
    status: row.status,
    selectedVoters: number(row.selected_voters),
    successfulVoters: number(row.successful_voters),
    retryEligibleVoters: number(row.retry_eligible_voters),
    callAttempts: number(row.call_attempts),
    callbacksReceived: number(row.callbacks_received),
    connectedCalls: number(row.connected_calls),
    transcriptsCaptured: number(row.transcripts_captured),
    responsesCaptured: number(row.responses_captured),
    averageDurationSeconds: number(row.average_duration_seconds),
    callbackCoveragePct: percentage(row.callbacks_received, row.call_attempts),
    transcriptCoveragePct: percentage(row.transcripts_captured, row.connected_calls),
    responseCoveragePct: percentage(row.responses_captured, row.connected_calls)
  }));
}

export async function getCampaignStrategicAnalytics(campaignId, actor, selection = {}) {
  const campaignAnalysis = await getCampaignAnalysis(campaignId, actor);
  const db = await getDb();
  const iterationIds = campaignAnalysis.iterations.map((iteration) => iteration.id);
  const [records, runs] = await Promise.all([
    loadStrategicEvidence(db, iterationIds),
    loadRunCatalog(db, iterationIds)
  ]);
  const completed = campaignAnalysis.iterations.filter((iteration) => iteration.completed);
  const defaultIteration = completed.at(-1) || campaignAnalysis.iterations.at(-1) || null;
  const selectedIteration = selection.iterationId
    ? campaignAnalysis.iterations.find((iteration) => iteration.id === selection.iterationId)
    : defaultIteration;
  if (selection.iterationId && !selectedIteration) {
    throw errorWithStatus("Iteration is not part of this Campaign", 404);
  }
  const iterationRuns = selectedIteration
    ? runs.filter((run) => run.iterationId === selectedIteration.id)
    : [];
  const selectedRun = selection.runId
    ? iterationRuns.find((run) => run.id === selection.runId)
    : null;
  if (selection.runId && !selectedRun) {
    throw errorWithStatus("Run is not part of the selected Iteration", 404);
  }
  const scopedRecords = selectedIteration
    ? latestRespondents(records, selectedIteration.id, selectedRun?.id || null)
    : [];
  const demographicFilters = {
    gender: selection.gender || null,
    ageBand: selection.ageBand || null,
    mandal: selection.mandal || null
  };
  const availableFilters = filterOptions(scopedRecords);
  const filteredRecords = filterRespondents(scopedRecords, demographicFilters);
  const hasDemographicFilter = Object.values(demographicFilters).some(Boolean);
  const segmentSuppressed = hasDemographicFilter
    && filteredRecords.length < MINIMUM_SEGMENT_BASE;
  const selectedRecords = segmentSuppressed ? [] : filteredRecords;
  const performance = questionPerformance(selectedRecords);
  const issuePriority = distribution(selectedRecords, "graduate_issue_priority", classifyIssue);
  const candidateAwareness = distribution(selectedRecords, "veeresh_awareness", classifyAwareness);
  const candidateFit = distribution(selectedRecords, "veeresh_criterion_fit");
  const candidateImpression = distribution(selectedRecords, "veeresh_impression");
  const preferredCandidateCriterion = distribution(selectedRecords, "candidate_criterion");
  const roleAwareness = distribution(selectedRecords, "mlc_role_awareness");
  const incumbentAwareness = distribution(selectedRecords, "incumbent_awareness");
  const incumbentAssessment = distribution(selectedRecords, "incumbent_assessment");
  const partySalience = distribution(selectedRecords, "party_salience_unaided", classifyParty);
  const issueLeader = distribution(selectedRecords, "perceived_issue_leader_aided", classifyParty);
  const associationInfluence = distribution(selectedRecords, "association_influence");
  const associations = distribution(selectedRecords, "association_named");
  const developmentPriorities = firstAvailableDistribution(selectedRecords, [
    "development_priority", "priority_development"
  ], classifyIssue);
  const desiredChanges = firstAvailableDistribution(selectedRecords, [
    "desired_change", "expected_change", "change_priority"
  ], classifyIssue);
  const partyLeanIndex = directFivePointIndex(selectedRecords);
  const themes = transcriptThemes(selectedRecords);
  const demoRespondents = selectedRecords.filter((record) => record.is_demo_contact).length;
  const answeredQuestions = performance.filter((question) => question.answered > 0);
  const averageAnswerCoveragePct = answeredQuestions.length
    ? Number((answeredQuestions.reduce((total, question) => total + question.answeredPct, 0) / answeredQuestions.length).toFixed(1))
    : 0;
  const iterationDashboard = buildIterationDashboard(selectedRecords, {
    issuePriority,
    partySalience,
    issueLeader,
    incumbentAssessment,
    associationInfluence,
    averageAnswerCoveragePct,
    demoRespondents
  });
  const comparison = campaignAnalysis.comparison
    ? {
        previousIteration: campaignAnalysis.comparison.previousIteration,
        latestIteration: campaignAnalysis.comparison.latestIteration,
        movements: campaignAnalysis.comparison.questions
          .filter((question) => question.comparable && question.largestShift)
          .slice(0, 12)
          .map((question) => ({
            key: question.key,
            label: question.label,
            respondentBases: question.iterations.map((iteration) => ({
              iterationId: iteration.iterationId,
              respondents: iteration.totalRespondents
            })),
            largestShift: question.largestShift
          }))
      }
    : null;

  const warnings = [...campaignAnalysis.readiness.warnings];
  if (!selection.iterationId && selectedIteration) {
    warnings.unshift(`Campaign overview uses Iteration ${selectedIteration.number} for current signal distributions; movement is shown separately across compatible Iterations.`);
  }
  if (selectedRun) {
    warnings.unshift(selectedRun.number > 1
      ? `Run ${selectedRun.number} is a retry cohort. Use it for response quality and retry-bias review, not as independent opinion movement.`
      : "Run-level findings describe the contacted Run cohort and should not be generalized to the full electorate.");
  }
  if (selectedRecords.length && demoRespondents === selectedRecords.length) {
    warnings.unshift("The selected Iteration contains only controlled demo respondents; all findings are directional demonstrations.");
  }
  if (!selectedRecords.length) {
    warnings.unshift(segmentSuppressed
      ? `This filtered segment is below the minimum reporting base of ${MINIMUM_SEGMENT_BASE}; political results are withheld.`
      : "No connected respondent evidence is available for the selected scope.");
  }

  const scopeOperations = selectedRun || (selectedIteration ? {
    selectedVoters: selectedIteration.selectedVoters,
    successfulVoters: selectedIteration.successfulVoters,
    retryEligibleVoters: selectedIteration.retryExhaustedVoters,
    callAttempts: selectedIteration.callAttempts,
    callbacksReceived: selectedIteration.callbacksReceived,
    connectedCalls: selectedIteration.connectedRespondents,
    transcriptsCaptured: selectedIteration.transcriptsCaptured,
    responsesCaptured: selectedIteration.responsesCaptured,
    averageDurationSeconds: selectedIteration.averageDurationSeconds,
    callbackCoveragePct: percentage(selectedIteration.callbacksReceived, selectedIteration.callAttempts),
    transcriptCoveragePct: percentage(selectedIteration.transcriptsCaptured, selectedIteration.connectedRespondents),
    responseCoveragePct: percentage(selectedIteration.responsesCaptured, selectedIteration.connectedRespondents)
  } : null);

  return {
    campaign: campaignAnalysis.campaign,
    scope: {
      level: selectedRun ? "RUN" : selection.iterationId ? "ITERATION" : "CAMPAIGN",
      iteration: selectedIteration,
      run: selectedRun,
      operations: scopeOperations,
      interpretation: selectedRun
        ? "Run results support execution-quality and retry-cohort diagnosis."
        : selection.iterationId
          ? "Iteration results deduplicate respondents across Runs using their latest connected evidence."
          : "Campaign view uses the latest completed Iteration for current signals and preserves Iteration movement separately."
    },
    options: {
      iterations: campaignAnalysis.iterations.map((iteration) => ({
        ...iteration,
        runs: runs.filter((run) => run.iterationId === iteration.id)
      })),
      filters: availableFilters
    },
    segment: {
      filters: demographicFilters,
      respondentBase: segmentSuppressed ? null : filteredRecords.length,
      minimumBase: MINIMUM_SEGMENT_BASE,
      suppressed: segmentSuppressed
    },
    validity: {
      ...campaignAnalysis.readiness,
      directionalOnly: true,
      latestRespondentBase: selectedRecords.length,
      latestDemoRespondents: demoRespondents,
      averageAnswerCoveragePct,
      warnings: Array.from(new Set(warnings))
    },
    latestIteration: selectedIteration,
    comparison,
    questionPerformance: performance,
    issueAnalysis: {
      priorities: issuePriority,
      developmentPriorities,
      desiredChanges
    },
    candidateAnalysis: {
      awareness: candidateAwareness,
      criterionFit: candidateFit,
      impression: candidateImpression,
      preferredCriterion: preferredCandidateCriterion
    },
    partyAndInstitutionalAnalysis: {
      roleAwareness,
      incumbentAwareness,
      incumbentAssessment,
      unaidedPartySalience: partySalience,
      aidedIssueLeader: issueLeader,
      associationInfluence,
      associations
    },
    iterationDashboard,
    partyLeanIndex,
    transcriptAnalysis: {
      transcriptRespondents: selectedRecords.filter((record) =>
        Boolean(transcriptText(record.interaction_transcript))
      ).length,
      themes
    },
    findings: strategicFindings(
      issuePriority,
      candidateAwareness,
      issueLeader,
      performance,
      selectedRecords.length
    ),
    generatedAt: new Date().toISOString()
  };
}
