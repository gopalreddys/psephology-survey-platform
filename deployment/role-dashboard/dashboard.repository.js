import { getDb } from "../db/postgres.js";
import { campaignReviewVisibilitySql } from "./campaign-visibility.repository.js";
import {
  loadIterationComparability,
  evaluateIterationComparison
} from "./research-comparability.repository.js";
import {
  summarizeOutput, OUTPUT_KEYS, SENTIMENT_CONSTRUCTS, getSentimentValidation
} from "./output-normalization.repository.js";

const ROLES = new Set(["SUPER_ADMIN", "ADMIN", "CAMPAIGN_MANAGER", "CAMPAIGNER"]);
const CLOSED_RUNS = new Set(["COMPLETED", "FAILED", "CANCELLED", "ARCHIVED"]);
const MINIMUM_REPORTING_BASE = 5;
const CANDIDATE_KEYS = OUTPUT_KEYS.candidate;
const DASHBOARD_SENTIMENT_CONSTRUCTS = SENTIMENT_CONSTRUCTS.filter((item) => item.type === "SENTIMENT");
const PARTY_KEYS = OUTPUT_KEYS.party;
const LEADERSHIP_KEYS = OUTPUT_KEYS.leadership;
const ISSUE_KEYS = OUTPUT_KEYS.issue;
const CODED_SENTIMENTS = new Set(["Positive", "Neutral", "Negative"]);

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

function requestedScopeId(value, label) {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string" || !value.trim()) {
    const error = new Error(`Invalid ${label} selection`);
    error.statusCode = 400;
    throw error;
  }
  return value.trim();
}

function scopeNotFound(label) {
  const error = new Error(`${label} not found in the selected visible scope`);
  error.statusCode = 404;
  throw error;
}

function percentage(value, total) {
  if (!total) return 0;
  return Number(((count(value) / count(total)) * 100).toFixed(1));
}

function scalarText(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (["number", "boolean"].includes(typeof value)) return String(value);
  if (Array.isArray(value)) return value.map(scalarText).filter(Boolean).join(", ");
  return "";
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

function chartValues(summary) {
  return summary.suppressed ? [] : summary.values;
}

function ratedSentiment(summary) {
  return summary.values.filter((item) => CODED_SENTIMENTS.has(item.value));
}

function ratedBase(summary) {
  return ratedSentiment(summary).reduce((total, item) => total + item.respondents, 0);
}

function segmentedSentiment(records, deriveSegment, outputKeys, order = []) {
  const segments = new Map();
  for (const record of records) {
    const segment = deriveSegment(record);
    const current = segments.get(segment) || [];
    current.push(record);
    segments.set(segment, current);
  }
  return Array.from(segments.entries())
    .map(([label, items]) => {
      const summary = summarizeOutput(items, outputKeys);
      const sentiment = chartValues(summary);
      return {
        label,
        base: items.length,
        answerBase: summary.answerBase,
        respondentBase: summary.respondentBase,
        missingCount: summary.missingCount,
        cantSayCount: summary.cantSayCount,
        refusedCount: summary.refusedCount,
        uncodedCount: summary.uncodedCount,
        coveragePct: summary.coveragePct,
        suppressed: summary.suppressed,
        sentiment,
        positivePct: summary.suppressed
          ? null
          : percentage(
              sentiment.find((item) => item.value === "Positive")?.respondents,
              summary.answerBase
            )
      };
    })
    .sort((left, right) => {
      const leftIndex = order.indexOf(left.label);
      const rightIndex = order.indexOf(right.label);
      if (leftIndex >= 0 || rightIndex >= 0) {
        return (leftIndex < 0 ? 999 : leftIndex) - (rightIndex < 0 ? 999 : rightIndex);
      }
      return left.label.localeCompare(right.label);
    });
}

function iterationRating(records, outputKeys) {
  const summary = summarizeOutput(records, outputKeys);
  const sentiment = ratedSentiment(summary);
  const answered = ratedBase(summary);
  if (answered < MINIMUM_REPORTING_BASE) return null;
  const score = sentiment.reduce((total, item) => {
    const value = item.value === "Positive" ? 5
      : item.value === "Negative" ? 1
        : 3;
    return total + (value * item.respondents);
  }, 0) / answered;
  return Number(score.toFixed(1));
}

function trendDirection(points) {
  if (points.length < 2) return "Insufficient history";
  const change = points.at(-1).value - points[0].value;
  if (change > 0.25) return "Improving";
  if (change < -0.25) return "Declining";
  return "Stable";
}

function nextIterationProjection(points) {
  if (points.length < 2) return null;
  const changes = points.slice(1).map((point, index) =>
    point.value - points[index].value
  );
  const averageChange = changes.reduce((total, value) => total + value, 0) / changes.length;
  return Number(Math.min(Math.max(points.at(-1).value + averageChange, 1), 5).toFixed(1));
}

function questionnaireSnapshot(value) {
  if (!value) return null;
  if (typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function researchInstrument(iteration) {
  const snapshot = questionnaireSnapshot(iteration.questionnaire_snapshot);
  const code = scalarText(snapshot?.code);
  const version = scalarText(snapshot?.version);
  const researchPhase = scalarText(iteration.research_phase).toUpperCase();
  const sampleDesign = scalarText(iteration.sample_design_type).toUpperCase();
  if (!code || !version || !researchPhase || !sampleDesign) return null;
  return {
    code,
    version,
    researchPhase,
    sampleDesign,
    key: [code, version, researchPhase, sampleDesign].join("::")
  };
}

function buildComparableTrend(availableIterations, evidenceRows, selectedCampaign, selectedIteration, comparabilityById, outputKeys) {
  const trendCampaignId = selectedCampaign?.id || selectedIteration?.campaign_id || null;
  if (!trendCampaignId) {
    return {
      status: "NOT_COMPARABLE",
      reason: "Select one Campaign before interpreting movement across Iterations.",
      points: [],
      includedIterations: 0,
      excludedIterations: availableIterations.length,
      instrument: null,
      reasons: ["Select one Campaign before comparing Iterations."],
      comparisons: []
    };
  }

  const campaignIterations = availableIterations.filter((iteration) =>
    iteration.campaign_id === trendCampaignId &&
    (!selectedIteration || count(iteration.iteration_number) <= count(selectedIteration.iteration_number))
  ).sort((left, right) => count(left.iteration_number) - count(right.iteration_number));
  const evidenceByIteration = new Map();
  for (const record of evidenceRows) {
    if (record.campaign_id !== trendCampaignId) continue;
    const current = evidenceByIteration.get(record.iteration_id) || [];
    current.push(record);
    evidenceByIteration.set(record.iteration_id, current);
  }
  const referenceIteration = selectedIteration?.campaign_id === trendCampaignId
    ? selectedIteration
    : campaignIterations.at(-1) || null;
  const instrument = referenceIteration ? researchInstrument(referenceIteration) : null;
  const emptyTrend = (status, reason, reasons) => ({
    status,
    reason,
    reasons,
    points: [],
    includedIterations: 0,
    excludedIterations: campaignIterations.length,
    instrument,
    comparisons: []
  });
  if (!referenceIteration) {
    return emptyTrend("NO_HISTORY", "Trend unavailable—there are no Iterations in this Campaign scope.", ["No Iteration history is available."]);
  }
  const wavePoints = campaignIterations.map((iteration) => {
    const records = evidenceByIteration.get(iteration.id) || [];
    return {
      iterationId: iteration.id,
      iterationNumber: count(iteration.iteration_number),
      iterationName: iteration.iteration_name,
      campaignName: iteration.campaign_name,
      base: records.length,
      answeredBase: ratedBase(summarizeOutput(records, outputKeys)),
      value: iterationRating(records, outputKeys)
    };
  });
  const latestPoint = wavePoints.at(-1);
  if (!latestPoint || latestPoint.answeredBase === 0) {
    return emptyTrend("NO_HISTORY", "Trend unavailable—this Iteration has no rated responses for the selected scope.", ["No rated responses are available for the selected scope."]);
  }
  if (latestPoint.answeredBase < MINIMUM_REPORTING_BASE) {
    return emptyTrend("SUPPRESSED", `Trend withheld—this Iteration has fewer than ${MINIMUM_REPORTING_BASE} rated respondents for the selected scope.`, [`Fewer than ${MINIMUM_REPORTING_BASE} rated respondents are available for the selected scope.`]);
  }

  const points = [latestPoint];
  const comparisons = [];
  let stopped = null;
  for (let index = wavePoints.length - 1; index > 0; index -= 1) {
    const previous = wavePoints[index - 1];
    const latest = wavePoints[index];
    const comparison = evaluateIterationComparison(previous.iterationId, latest.iterationId, comparabilityById);
    comparisons.unshift(comparison);
    if (comparison.status !== "COMPARABLE") {
      stopped = { status: "NOT_COMPARABLE", reasons: comparison.reasons };
      break;
    }
    if (previous.answeredBase === 0) {
      stopped = { status: "NO_HISTORY", reasons: ["No rated responses are available for the selected scope."] };
      break;
    }
    if (previous.answeredBase < MINIMUM_REPORTING_BASE) {
      stopped = { status: "SUPPRESSED", reasons: [`Fewer than ${MINIMUM_REPORTING_BASE} rated respondents are available for the selected scope.`] };
      break;
    }
    points.unshift(previous);
  }
  const excludedIterations = campaignIterations.length - points.length;

  if (points.length < 2) {
    return {
      status: stopped?.status === "NOT_COMPARABLE" ? "NOT_COMPARABLE" : "INSUFFICIENT_COMPARABLE_HISTORY",
      reason: stopped?.status === "NOT_COMPARABLE"
        ? `Trend unavailable—the consecutive Iteration comparison failed: ${stopped.reasons.join(", ")}.`
        : stopped?.status === "SUPPRESSED"
          ? `Trend unavailable—the preceding Iteration has fewer than ${MINIMUM_REPORTING_BASE} rated respondents for the selected scope.`
          : "Trend unavailable—at least two consecutive comparable Iterations with reportable responses are required.",
      points,
      includedIterations: points.length,
      excludedIterations,
      instrument,
      reasons: stopped?.reasons || ["At least two consecutive comparable Iterations with reportable responses are required."],
      comparisons
    };
  }

  return {
    status: "DIRECTIONAL",
    reason: `${points.length} consecutive comparable Iterations are included; ${excludedIterations} earlier Iteration${excludedIterations === 1 ? " is" : "s are"} excluded.${stopped ? ` History stops at ${stopped.reasons.join(", ")}.` : ""}`,
    points,
    includedIterations: points.length,
    excludedIterations,
    instrument,
    reasons: stopped?.reasons || [],
    comparisons
  };
}

export function buildDashboardIntelligence(actor, campaigns, iterationRows, evidenceRows, selection, comparabilityById = new Map()) {
  if (actor.role_code === "CAMPAIGNER") return null;
  const requestedProgramId = requestedScopeId(selection.programId, "Program");
  const requestedCampaignId = requestedScopeId(selection.campaignId, "Campaign");
  const requestedIterationId = requestedScopeId(selection.iterationId, "Iteration");
  const selectedSentimentConstruct = requestedScopeId(selection.sentimentConstruct, "Sentiment construct") || "candidate_impression";
  const sentimentConstruct = DASHBOARD_SENTIMENT_CONSTRUCTS.find((item) => item.key === selectedSentimentConstruct);
  if (!sentimentConstruct) {
    const error = new Error("Unsupported Sentiment construct filter");
    error.statusCode = 400;
    throw error;
  }
  const sentimentKeys = sentimentConstruct.outputKeys;
  const requestedCampaign = requestedCampaignId
    ? campaigns.find((campaign) => campaign.id === requestedCampaignId) : null;
  if (requestedCampaignId && !requestedCampaign) scopeNotFound("Campaign");
  const requestedIteration = requestedIterationId
    ? iterationRows.find((iteration) => iteration.id === requestedIterationId &&
        (!requestedCampaign || iteration.campaign_id === requestedCampaign.id)) : null;
  if (requestedIterationId && !requestedIteration) scopeNotFound("Iteration");
  const impliedCampaign = requestedCampaign || (requestedIteration
    ? campaigns.find((campaign) => campaign.id === requestedIteration.campaign_id) : null);
  const programs = Array.from(new Map(campaigns.map((campaign) => [
    campaign.programId || "unlinked",
    {
      id: campaign.programId || "unlinked",
      name: campaign.programName || "Unlinked research",
      code: campaign.programCode || "UNLINKED"
    }
  ])).values()).sort((left, right) => left.name.localeCompare(right.name));
  const selectedProgram = programs.find((program) => program.id === requestedProgramId)
    || (!requestedProgramId && impliedCampaign
      ? programs.find((program) => program.id === (impliedCampaign.programId || "unlinked")) : null)
    || programs.find((program) => campaigns.some((campaign) =>
      (campaign.programId || "unlinked") === program.id &&
      evidenceRows.some((record) => record.campaign_id === campaign.id)
    ))
    || programs[0]
    || null;
  if (requestedProgramId && selectedProgram?.id !== requestedProgramId) scopeNotFound("Program");
  if (!selectedProgram) return null;

  const programCampaigns = campaigns.filter((campaign) =>
    (campaign.programId || "unlinked") === selectedProgram.id
  );
  const selectedCampaign = programCampaigns.find((campaign) =>
    campaign.id === requestedCampaignId
  ) || null;
  if (requestedCampaignId && !selectedCampaign) scopeNotFound("Campaign");
  const campaignScopeIds = new Set(
    (selectedCampaign ? [selectedCampaign] : programCampaigns).map((campaign) => campaign.id)
  );
  const availableIterations = iterationRows
    .filter((iteration) => campaignScopeIds.has(iteration.campaign_id))
    .sort((left, right) => {
      const campaignCompare = String(left.campaign_name || "").localeCompare(String(right.campaign_name || ""));
      return campaignCompare || count(left.iteration_number) - count(right.iteration_number);
    });
  const selectedIteration = availableIterations.find((iteration) =>
    iteration.id === requestedIterationId
  ) || null;
  if (requestedIterationId && !selectedIteration) scopeNotFound("Iteration");
  const scopeRecords = evidenceRows.filter((record) =>
    campaignScopeIds.has(record.campaign_id) &&
    (!selectedIteration || record.iteration_id === selectedIteration.id)
  );
  const selectedMandal = requestedScopeId(selection.mandal, "Mandal");
  const selectedGender = requestedScopeId(selection.gender, "Gender");
  if (selectedGender && !["Female", "Male", "Other / self-described", "Unknown"].includes(selectedGender)) {
    const error = new Error("Unsupported Gender filter");
    error.statusCode = 400;
    throw error;
  }
  const mandals = Array.from(new Set([
    ...scopeRecords.map((record) => normalizeMandal(record.mandal_name)),
    ...(selectedMandal ? [selectedMandal] : [])
  ])).sort();
  const genders = Array.from(new Set([
    ...scopeRecords.map((record) => normalizeGender(record.gender)),
    ...(selectedGender ? [selectedGender] : [])
  ])).sort();
  const ageBands = ["18–29", "30–39", "40–49", "50+"];
  const selectedAgeBand = requestedScopeId(selection.ageBand, "Age band");
  if (selectedAgeBand && !ageBands.includes(selectedAgeBand)) {
    const error = new Error("Unsupported Age band filter");
    error.statusCode = 400;
    throw error;
  }
  const matchesSegment = (record) => {
    if (selectedMandal && normalizeMandal(record.mandal_name) !== selectedMandal) return false;
    if (selectedGender && normalizeGender(record.gender) !== selectedGender) return false;
    if (selectedAgeBand && ageBand(record.age) !== selectedAgeBand) return false;
    return true;
  };
  const records = scopeRecords.filter(matchesSegment);
  const hasSegmentFilter = Boolean(selectedMandal || selectedGender || selectedAgeBand);
  const scopeLabel = hasSegmentFilter
    ? `Selected segment: ${[
        selectedMandal ? `Mandal ${selectedMandal}` : "all Mandals",
        selectedGender || "all genders",
        selectedAgeBand ? `age ${selectedAgeBand}` : "all age bands"
      ].join(" · ")}`
    : selectedIteration ? "Full Iteration: all Mandals, genders and age bands" : "Full selected research scope: all Mandals, genders and age bands";
  const suppressed = records.length < MINIMUM_REPORTING_BASE;
  const reportable = suppressed ? [] : records;
  const measures = {
    sentiment: summarizeOutput(records, sentimentKeys),
    issues: summarizeOutput(records, ISSUE_KEYS),
    party: summarizeOutput(records, PARTY_KEYS),
    candidate: summarizeOutput(records, CANDIDATE_KEYS),
    leadership: summarizeOutput(records, LEADERSHIP_KEYS)
  };
  const sentiment = chartValues(measures.sentiment);
  const issues = chartValues(measures.issues);
  const trendScope = buildComparableTrend(
    availableIterations,
    evidenceRows.filter(matchesSegment),
    selectedCampaign,
    selectedIteration,
    comparabilityById,
    sentimentKeys
  );
  const trend = trendScope.points;
  const rating = iterationRating(reportable, sentimentKeys);
  const codedAssessmentBase = ratedBase(measures.sentiment);
  const confidence = rating === null ? "Not assessed" : "Descriptive only";
  const predictiveConfidence = trendScope.status !== "DIRECTIONAL"
    ? "Not assessed" : "Descriptive only";

  return {
    programs,
    program: selectedProgram,
    campaign: selectedCampaign ? {
      id: selectedCampaign.id,
      name: selectedCampaign.name,
      code: selectedCampaign.code
    } : null,
    iteration: selectedIteration ? {
      id: selectedIteration.id,
      number: count(selectedIteration.iteration_number),
      name: selectedIteration.iteration_name
    } : null,
    filters: {
      campaigns: programCampaigns.map((campaign) => ({
        id: campaign.id,
        name: campaign.name,
        code: campaign.code
      })),
      iterations: availableIterations.map((iteration) => ({
        id: iteration.id,
        number: count(iteration.iteration_number),
        name: iteration.iteration_name,
        campaignName: iteration.campaign_name
      })),
      mandals,
      genders,
      ageBands,
      sentimentConstructs: DASHBOARD_SENTIMENT_CONSTRUCTS.map((item) => ({ key: item.key, label: item.label })),
      selectedProgramId: selectedProgram.id,
      selectedCampaignId: selectedCampaign?.id || "",
      selectedIterationId: selectedIteration?.id || "",
      selectedMandal,
      selectedGender,
      selectedAgeBand,
      selectedSentimentConstruct
    },
    minimumBase: MINIMUM_REPORTING_BASE,
    scopeLabel,
    respondentBase: suppressed ? null : reportable.length,
    suppressed,
    sentimentConstruct,
    sentimentValidation: getSentimentValidation(),
    rating: {
      value: rating,
      scale: 5,
      confidence,
      answeredBase: codedAssessmentBase,
      basis: `${sentimentConstruct.label} only (${sentimentKeys.join(", ")}). Descriptive average: Positive=5, Neutral=3, Negative=1. Mixed, None, missing, Can't say, Refused and Uncoded responses are excluded; at least five polarity-coded assessments are required. No other construct supplies missing answers. Human review pending.`
    },
    measures,
    sentiment,
    issues,
    landscape: {
      party: chartValues(measures.party),
      candidate: chartValues(measures.candidate),
      leadership: chartValues(measures.leadership)
    },
    age: segmentedSentiment(reportable, (record) => ageBand(record.age), sentimentKeys, ["18–29", "30–39", "40–49", "50+", "Unknown"]),
    gender: segmentedSentiment(reportable, (record) => normalizeGender(record.gender), sentimentKeys, ["Female", "Male", "Other / self-described", "Unknown"]),
    mandalHeatmap: segmentedSentiment(records, (record) => normalizeMandal(record.mandal_name), sentimentKeys),
    predictive: {
      status: trendScope.status,
      scopeLabel: hasSegmentFilter ? `${scopeLabel} in each Iteration` : "Full Iteration in each wave: all Mandals, genders and age bands",
      direction: trendScope.status === "NOT_COMPARABLE"
        ? "Trend unavailable"
        : trendScope.status === "SUPPRESSED"
          ? "Trend withheld"
          : trendScope.status === "NO_HISTORY"
            ? "No rated history"
        : trendScope.status === "INSUFFICIENT_COMPARABLE_HISTORY"
          ? "Insufficient comparable history"
          : trendDirection(trend),
      points: trend,
      projectedNextRating: trendScope.status === "DIRECTIONAL"
        ? nextIterationProjection(trend)
        : null,
      confidence: predictiveConfidence,
      statement: trendScope.status === "DIRECTIONAL"
        ? `${trendScope.reason} ${sentimentConstruct.label} is kept fixed across every included wave. The result is directional, not an election forecast or participant-level prediction. Human review pending.`
        : trendScope.reason,
      comparability: {
        source: "analytics_iteration_comparability_v1",
        reasons: trendScope.reasons,
        comparisons: trendScope.comparisons,
        includedIterations: trendScope.includedIterations,
        excludedIterations: trendScope.excludedIterations,
        questionnaireCode: trendScope.instrument?.code || null,
        questionnaireVersion: trendScope.instrument?.version || null,
        researchPhase: trendScope.instrument?.researchPhase || null,
        sampleDesign: trendScope.instrument?.sampleDesign || null
      }
    },
    methodology: {
      sampleType: "UNWEIGHTED_DIRECTIONAL",
      weighted: false,
      analysisUnit: "Latest connected structured response per respondent in each Iteration",
      disclosure: "Demo results are unweighted and directional. Segment cells below five respondents are withheld."
    }
  };
}

function action(kind, priority, title, detail, href, campaignName = null) {
  return { kind, priority, title, detail, href, campaignName };
}

function sortActions(items) {
  return items.sort((left, right) =>
    right.priority - left.priority || left.title.localeCompare(right.title)
  ).slice(0, 12);
}

function buildDashboard(actor, campaignRows, iterationRows, runRows, evidenceRows, selection, comparabilityById) {
  const campaigns = campaignRows.map((row) => ({
    id: row.id,
    name: row.campaign_name,
    code: row.campaign_code,
    programId: row.program_id,
    programName: row.program_name,
    programCode: row.program_code,
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
      successfulContacts: count(row.successful_contacts),
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
    successfulContacts: runs.reduce((total, run) => total + run.successfulContacts, 0),
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

  const orderedActions = sortActions(actions);
  const evidenceExceptions = summary.staleCallbacks +
    summary.missingTranscripts + summary.missingResponses;
  const roleBrief = (() => {
    if (actor.role_code === "CAMPAIGNER") {
      const attentionCount = summary.runsReady + summary.retryEligibleContacts +
        summary.staleCallbacks;
      return {
        eyebrow: "EXECUTION RESPONSIBILITY",
        title: attentionCount > 0 ? "Calls require your attention" : "Allocated work is under control",
        status: summary.staleCallbacks > 0 ? "ATTENTION_REQUIRED" :
          attentionCount > 0 ? "ACTION_AVAILABLE" : "ON_TRACK",
        description: "Review only your allocated recipients, launch approved Runs, and follow up retry-eligible contacts. Research interpretation remains with the Campaign Manager.",
        responsibility: `${summary.runsReady} ready Run${summary.runsReady === 1 ? "" : "s"} · ${summary.pendingContacts} pending contact${summary.pendingContacts === 1 ? "" : "s"}`,
        boundary: "You can execute allocated work; you cannot view portfolio-level research findings.",
        nextHref: orderedActions[0]?.href || "/calls",
        nextLabel: orderedActions[0]?.title || "Review call activity"
      };
    }
    if (actor.role_code === "CAMPAIGN_MANAGER") {
      const openIterations = Math.max(summary.iterationsVisible - summary.iterationsCompleted, 0);
      return {
        eyebrow: "RESEARCH OWNERSHIP",
        title: openIterations > 0 ? "Move assigned research toward completion" : "Assigned research is ready for review",
        status: evidenceExceptions > 0 ? "ATTENTION_REQUIRED" :
          openIterations > 0 ? "IN_PROGRESS" : "REVIEW_READY",
        description: "Own Iteration planning, monitor execution quality, and interpret evidence before campaign closeout.",
        responsibility: `${openIterations} open Iteration${openIterations === 1 ? "" : "s"} · ${summary.successfulContacts} successful contact outcome${summary.successfulContacts === 1 ? "" : "s"}`,
        boundary: "Use Analytics for directional research decisions; demo samples are not vote forecasts.",
        nextHref: orderedActions[0]?.href || "/analytics",
        nextLabel: orderedActions[0]?.title || "Review assigned analytics"
      };
    }
    if (actor.role_code === "ADMIN") {
      return {
        eyebrow: "CAMPAIGN ADMINISTRATION",
        title: summary.campaignsWithoutManager > 0 ? "Resolve campaign ownership" : "Campaign controls are in place",
        status: summary.campaignsWithoutManager > 0 || evidenceExceptions > 0 ?
          "ATTENTION_REQUIRED" : "ON_TRACK",
        description: "Maintain campaign setup, manager assignment, execution readiness, and evidence completeness within your administrative scope.",
        responsibility: `${summary.campaignsWithoutManager} ownership gap${summary.campaignsWithoutManager === 1 ? "" : "s"} · ${summary.runsReady + summary.runsRunning} active Run${summary.runsReady + summary.runsRunning === 1 ? "" : "s"}`,
        boundary: "Administration governs access and readiness; Campaign Managers own research interpretation.",
        nextHref: orderedActions[0]?.href || "/campaigns",
        nextLabel: orderedActions[0]?.title || "Review campaign administration"
      };
    }
    return {
      eyebrow: "PLATFORM GOVERNANCE",
      title: summary.campaignsWithoutManager > 0 || evidenceExceptions > 0 ?
        "Portfolio exceptions need review" : "Visible portfolio is operationally healthy",
      status: summary.campaignsWithoutManager > 0 || evidenceExceptions > 0 ?
        "ATTENTION_REQUIRED" : "ON_TRACK",
      description: "Monitor ownership, lifecycle progress, service evidence, and governance exceptions across the visible platform portfolio.",
      responsibility: `${summary.campaignsVisible} visible Campaign${summary.campaignsVisible === 1 ? "" : "s"} · ${evidenceExceptions} evidence exception${evidenceExceptions === 1 ? "" : "s"}`,
      boundary: "Govern platform health and access without treating directional survey evidence as electoral prediction.",
      nextHref: orderedActions[0]?.href || "/analytics",
      nextLabel: orderedActions[0]?.title || "Review portfolio analytics"
    };
  })();

  return {
    role: actor.role_code,
    roleBrief,
    summary,
    actions: orderedActions,
    campaigns: campaigns
      .sort((left, right) => new Date(right.updatedAt) - new Date(left.updatedAt))
      .slice(0, 8)
      .map((campaign) => {
        const campaignRuns = campaign.iterations.flatMap((iteration) => iteration.runs);
        const attempts = campaignRuns.reduce((total, run) => total + run.callAttempts, 0);
        const connected = campaignRuns.reduce((total, run) => total + run.connectedCalls, 0);
        const successful = campaignRuns.reduce((total, run) => total + run.successfulContacts, 0);
        const missingEvidence = campaignRuns.reduce((total, run) =>
          total + run.missingTranscripts + run.missingResponses,
          0
        );
        return {
          ...campaign,
          iterationCount: campaign.iterations.length,
          completedIterationCount: campaign.iterations.filter((iteration) =>
            completedIterations.includes(iteration)
          ).length,
          activeRunCount: campaignRuns.filter((run) =>
            ["READY", "RUNNING"].includes(run.status)
          ).length,
          callAttempts: attempts,
          connectedCalls: connected,
          successfulContacts: successful,
          evidenceExceptions: missingEvidence,
          connectionRatePct: attempts ? Number(((connected / attempts) * 100).toFixed(1)) : 0,
          evidenceReadyPct: connected
            ? Number((Math.min(
                Math.max((connected * 2) - missingEvidence, 0) / (connected * 2),
                1
              ) * 100).toFixed(1))
            : 0,
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
        };
      }),
    intelligence: buildDashboardIntelligence(
      actor,
      campaigns,
      iterationRows,
      evidenceRows,
      selection,
      comparabilityById
    ),
    generatedAt: new Date().toISOString()
  };
}

export async function getRoleDashboard(actor, selection = {}) {
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
      campaign.program_id, program.study_name AS program_name,
      program.study_code AS program_code, campaign.status,
      campaign.campaign_manager_user_id, campaign.updated_at
    FROM campaigns campaign
    LEFT JOIN survey_studies program ON program.id = campaign.program_id
    WHERE campaign.status <> 'ARCHIVED' AND ${scope.sql}
    ORDER BY campaign.updated_at DESC
  `, scope.values);

  const iterationsPromise = db.query(`
    SELECT iteration.id, link.campaign_id, iteration.iteration_number,
      iteration.iteration_name, COALESCE(link.status, iteration.status) AS status,
      iteration.questionnaire_id, iteration.questionnaire_snapshot,
      iteration.research_phase, iteration.sample_design_type,
      iteration.voice_agent_id,
      campaign.campaign_name, campaign.program_id
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
          AND contact.retry_exhausted = FALSE)::int AS retry_eligible_contacts,
        COUNT(*) FILTER (WHERE contact.final_status IN (
          'SUCCESS_PULSE', 'SUCCESS_COMPLETE', 'SUCCESS_SUBSTANTIAL'
        ))::int AS successful_contacts
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
      COALESCE(contact.successful_contacts, 0)::int AS successful_contacts,
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

  const evidencePromise = actor.role_code === "CAMPAIGNER"
    ? Promise.resolve({ rows: [] })
    : db.query(`
      WITH scoped_campaigns AS (
        SELECT campaign.id
        FROM campaigns campaign
        WHERE campaign.status <> 'ARCHIVED' AND ${scope.sql}
      ), evidence AS (
        SELECT DISTINCT ON (
          link.campaign_id,
          call_record.iteration_id,
          COALESCE(call_record.voter_id, call_record.id)
        ) link.campaign_id, call_record.iteration_id, call_record.voter_id,
          voter.gender, voter.age, voter.mandal_name_source AS mandal_name,
          call_record.response_variables, call_record.updated_at
        FROM campaign_iteration_links link
        JOIN scoped_campaigns campaign ON campaign.id = link.campaign_id
        JOIN calls call_record ON call_record.iteration_id = link.iteration_id
        LEFT JOIN voter_master voter ON voter.id = call_record.voter_id
        WHERE LOWER(COALESCE(call_record.connectivity_status, '')) = 'connected'
          AND jsonb_typeof(call_record.response_variables) = 'object'
          AND call_record.response_variables <> '{}'::jsonb
        ORDER BY link.campaign_id, call_record.iteration_id,
          COALESCE(call_record.voter_id, call_record.id),
          call_record.updated_at DESC NULLS LAST
      )
      SELECT * FROM evidence
    `, scope.values);

  const [campaigns, iterations, runs, evidence] = await Promise.all([
    campaignsPromise,
    iterationsPromise,
    runsPromise,
    evidencePromise
  ]);
  const comparabilityById = actor.role_code === "CAMPAIGNER"
    ? new Map()
    : await loadIterationComparability(db, iterations.rows.map((iteration) => iteration.id));
  return buildDashboard(
    actor,
    campaigns.rows,
    iterations.rows,
    runs.rows,
    evidence.rows,
    selection,
    comparabilityById
  );
}
