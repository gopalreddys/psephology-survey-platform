export type FieldworkPartitionStatus = "AVAILABLE" | "WITHHELD" | "NOT_AVAILABLE";
export type FieldworkDiagnostics = {
  schemaVersion: 1;
  rulesVersion: "CONTACT_COHORT_V1";
  status: FieldworkPartitionStatus | "IN_PROGRESS";
  reason: "NONE" | "NOT_AVAILABLE" | "NO_SELECTED_ITERATION" | "SOURCE_SCHEMA_UNAVAILABLE" | "NOT_LOADED" | "INITIAL_COHORT_UNAVAILABLE" | "SOURCE_INTEGRITY_UNVERIFIED" | "SCOPE_MISMATCH";
  observedAt: string | null;
  scope: { campaignId: string; iterationId: string; filters: { gender: string | null; ageBand: string | null; mandal: string | null } } | null;
  sources: {
    cohort: "RETAINED_RUN_1_DATABASE_IDS" | "NOT_AVAILABLE";
    demographics: "CURRENT_MASTER_DATA";
    eligibleFrame: "NOT_RECORDED";
    probabilitySampling: "NOT_VERIFIED";
    standardizedResponseRate: "UNAVAILABLE";
    surveyCompletion: "UNAVAILABLE";
    analysisBaseAlignment: "MATCHED" | "MISMATCH" | "NOT_ASSESSED";
    outsideInitialCohort: "NONE_OBSERVED" | "OBSERVED" | "NOT_ASSESSED";
  };
  coverage: {
    status: FieldworkPartitionStatus;
    selectedBase: number | null;
    stages: Array<{ key: string; title: string; participants: number | null; percentage: number | null }>;
    yield: { numerator: number; denominator: number; percentage: number | null; label: string } | null;
  };
  outcomes: { status: FieldworkPartitionStatus; base: number | null; rows: Array<{ key: string; title: string; participants: number | null; percentage: number | null }> };
  demographics: Record<"gender" | "ageBand" | "mandal", {
    status: FieldworkPartitionStatus;
    selectedBase: number | null;
    structuredBase: number | null;
    rows: Array<{ category: string; selected: number | null; structured: number | null; selectedPct: number | null; structuredPct: number | null; differencePp: number | null }>;
  }>;
  limitations: string[];
  nextActions: string[];
};

export type ResearchReport = {
  schemaVersion: 2;
  rulesVersion: string;
  reportId: string;
  checksum: string;
  generatedAt: string | null;
  campaign: { id: string; code: string | null; name: string | null; status: string | null };
  scope: {
    requestedLevel: string | null;
    insightLevel: "ITERATION";
    iterationId: string | null;
    iterationNumber: number | null;
    iterationName: string | null;
    run: { id: string; number: number; status: string } | null;
    filters: { gender: string | null; ageBand: string | null; mandal: string | null };
    fieldworkStatus: "CLOSED" | "IN_PROGRESS" | "NOT_AVAILABLE";
    description: string;
  };
  sources: {
    analysisGeneratedAt: string | null;
    latestEvidenceAt: string | null;
    questionnaire: { id: string | null; code: string | null; version: number | string | null; contentFingerprint: string | null; frozenQuestionCount: number | null; definitionSource: string; status: string };
    voiceAgent: { id: string | null; code: string | null; appId: string | null; version: number | string | null; basis: "ITERATION_ASSIGNMENT_SNAPSHOT" } | null;
    normalizationVersion: string | null;
    normalizationRuleHash: string | null;
    frozenInstrumentHash: string | null;
  };
  methodology: {
    declarationStatus: string;
    revision: number | null;
    declaredAt: string | null;
    fieldworkMode: string | null;
    samplingMethod: string | null;
    cohortDesign: string | null;
    weighting: { status: string; declaredStatus: string | null; message: string };
    representativeSampling: string;
    standardizedResponseRate: string;
    humanValidation: string;
    comparison: { status: string; reasons: string[] };
  };
  fieldworkDiagnostics: FieldworkDiagnostics;
  checks: Array<{ id: string; status: string; message: string }>;
  reports: Array<{
    id: string;
    title: string;
    definitionStatus: string;
    captureStatus: string;
    target: { type: string; id: string; name: string } | null;
    outputVariables: string[];
    questionCodes: string[];
    answerBase: number | null;
    codedBase: number | null;
    respondentBase: number | null;
    suppressed: boolean;
    distribution: Array<{ value: string; respondents: number; percentage: number | null }>;
    message: string;
    caution: string;
  }>;
  findings: Array<{ reportKey: string; type: "DESCRIPTIVE_DISTRIBUTION"; title: string; answerBase: number; caution: string }>;
  limitations: string[];
  nextActions: string[];
};

// Fail closed on incomplete, differently scoped or unexpected response fields.
// The JSON export retains the backend payload/checksum only after this entire
// schema is validated; respondent-level additions cannot silently enter a file.
export function parseResearchReport(value: unknown, campaignId: string, query: string): ResearchReport {
  function fail(): never { throw new Error("The research-report response is invalid or unsupported. Refresh or install the matching reporting release."); }
  const object = (item: unknown, keys: string[]): Record<string, unknown> => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return fail();
    const result = item as Record<string, unknown>;
    if (Object.keys(result).some((key) => !keys.includes(key)) || keys.some((key) => !Object.hasOwn(result, key))) return fail();
    return result;
  };
  const string = (item: unknown, maximum = 2000): item is string => typeof item === "string" && item.length <= maximum;
  const nullableString = (item: unknown, maximum = 2000) => item === null || string(item, maximum);
  const number = (item: unknown): item is number => typeof item === "number" && Number.isSafeInteger(item) && item >= 0;
  const nullableNumber = (item: unknown) => item === null || number(item);
  const date = (item: unknown) => item === null || (string(item, 40) && Number.isFinite(Date.parse(item)));
  const sha = (item: unknown): item is string => string(item, 64) && /^[a-f0-9]{64}$/.test(item);
  const strings = (item: unknown, maximum = 50) => Array.isArray(item) && item.length <= maximum && item.every((entry) => string(entry));
  const oneOf = (item: unknown, values: readonly string[]) => typeof item === "string" && values.includes(item);
  const root = object(value, ["schemaVersion", "rulesVersion", "reportId", "checksum", "generatedAt", "campaign", "scope", "sources", "methodology", "fieldworkDiagnostics", "checks", "reports", "findings", "limitations", "nextActions"]);
  if (root.schemaVersion !== 2 || root.rulesVersion !== "RESEARCH_REPORT_V2" || !sha(root.checksum)
    || !string(root.reportId, 100) || root.reportId !== `research-report-${root.checksum.slice(0, 24)}` || !date(root.generatedAt)) fail();
  const campaign = object(root.campaign, ["id", "code", "name", "status"]);
  if (campaign.id !== campaignId || !nullableString(campaign.code, 160) || !nullableString(campaign.name, 160) || !nullableString(campaign.status, 30)) fail();
  const scope = object(root.scope, ["requestedLevel", "insightLevel", "iterationId", "iterationNumber", "iterationName", "run", "filters", "fieldworkStatus", "description"]);
  if (!nullableString(scope.requestedLevel, 20) || scope.insightLevel !== "ITERATION" || !nullableString(scope.iterationId, 160)
    || !nullableNumber(scope.iterationNumber) || !nullableString(scope.iterationName, 160) || !string(scope.description)
    || !oneOf(scope.fieldworkStatus, ["CLOSED", "IN_PROGRESS", "NOT_AVAILABLE"])) fail();
  const filters = object(scope.filters, ["gender", "ageBand", "mandal"]);
  const requested = new URLSearchParams(query);
  if (["gender", "ageBand", "mandal"].some((key) => !nullableString(filters[key], 160) || filters[key] !== (requested.get(key) || null))
    || (requested.get("iterationId") && scope.iterationId !== requested.get("iterationId"))) fail();
  if (scope.run !== null) {
    const run = object(scope.run, ["id", "number", "status"]);
    if (!string(run.id, 160) || !number(run.number) || !nullableString(run.status, 30) || run.id !== requested.get("runId")) fail();
  } else if (requested.get("runId")) fail();
  const sources = object(root.sources, ["analysisGeneratedAt", "latestEvidenceAt", "questionnaire", "voiceAgent", "normalizationVersion", "normalizationRuleHash", "frozenInstrumentHash"]);
  if (!date(sources.analysisGeneratedAt) || !date(sources.latestEvidenceAt) || !nullableString(sources.normalizationVersion, 160)
    || (sources.normalizationRuleHash !== null && !sha(sources.normalizationRuleHash))
    || (sources.frozenInstrumentHash !== null && !sha(sources.frozenInstrumentHash))) fail();
  const instrument = object(sources.questionnaire, ["id", "code", "version", "contentFingerprint", "frozenQuestionCount", "definitionSource", "status"]);
  if (!["id", "code"].every((key) => nullableString(instrument[key], 160))
    || !(nullableString(instrument.version, 160) || number(instrument.version)) || !nullableNumber(instrument.frozenQuestionCount)
    || (instrument.contentFingerprint !== null && !sha(instrument.contentFingerprint))
    || !string(instrument.definitionSource, 100) || !string(instrument.status, 100)) fail();
  if (sources.voiceAgent !== null) {
    const agent = object(sources.voiceAgent, ["id", "code", "appId", "version", "basis"]);
    if (!["id", "code", "appId"].every((key) => nullableString(agent[key], 160)) || !(nullableString(agent.version, 160) || number(agent.version)) || agent.basis !== "ITERATION_ASSIGNMENT_SNAPSHOT") fail();
  }
  const methods = object(root.methodology, ["declarationStatus", "revision", "declaredAt", "fieldworkMode", "samplingMethod", "cohortDesign", "weighting", "representativeSampling", "standardizedResponseRate", "humanValidation", "comparison"]);
  if (!oneOf(methods.declarationStatus, ["DECLARED", "NOT_DECLARED"]) || !nullableNumber(methods.revision) || !date(methods.declaredAt)
    || !["fieldworkMode", "samplingMethod", "cohortDesign"].every((key) => nullableString(methods[key], 100))
    || methods.representativeSampling !== "NOT_VERIFIED" || methods.standardizedResponseRate !== "UNAVAILABLE" || methods.humanValidation !== "PENDING") fail();
  const weighting = object(methods.weighting, ["status", "declaredStatus", "message"]);
  if (weighting.status !== "UNAVAILABLE" || !nullableString(weighting.declaredStatus, 100) || !string(weighting.message)) fail();
  const comparison = object(methods.comparison, ["status", "reasons"]);
  if (!oneOf(comparison.status, ["BASELINE", "COMPARABLE", "NOT_COMPARABLE"]) || !strings(comparison.reasons)) fail();
  const diagnostics = object(root.fieldworkDiagnostics, ["schemaVersion", "rulesVersion", "status", "reason", "observedAt", "scope", "sources", "coverage", "outcomes", "demographics", "limitations", "nextActions"]);
  if (diagnostics.schemaVersion !== 1 || diagnostics.rulesVersion !== "CONTACT_COHORT_V1"
    || !oneOf(diagnostics.status, ["AVAILABLE", "IN_PROGRESS", "WITHHELD", "NOT_AVAILABLE"])
    || !oneOf(diagnostics.reason, ["NONE", "NOT_AVAILABLE", "NO_SELECTED_ITERATION", "SOURCE_SCHEMA_UNAVAILABLE", "NOT_LOADED", "INITIAL_COHORT_UNAVAILABLE", "SOURCE_INTEGRITY_UNVERIFIED", "SCOPE_MISMATCH"])
    || !date(diagnostics.observedAt) || !strings(diagnostics.limitations) || !strings(diagnostics.nextActions)
    || (diagnostics.status === "NOT_AVAILABLE") === (diagnostics.reason === "NONE")) fail();
  if (diagnostics.scope === null) {
    if (scope.iterationId !== null || diagnostics.status !== "NOT_AVAILABLE") fail();
  } else {
    const diagnosticScope = object(diagnostics.scope, ["campaignId", "iterationId", "filters"]);
    const diagnosticFilters = object(diagnosticScope.filters, ["gender", "ageBand", "mandal"]);
    if (diagnosticScope.campaignId !== campaign.id || !string(diagnosticScope.iterationId, 160) || diagnosticScope.iterationId !== scope.iterationId
      || ["gender", "ageBand", "mandal"].some((key) => diagnosticFilters[key] !== filters[key])) fail();
  }
  const diagnosticSources = object(diagnostics.sources, ["cohort", "demographics", "eligibleFrame", "probabilitySampling", "standardizedResponseRate", "surveyCompletion", "analysisBaseAlignment", "outsideInitialCohort"]);
  if (!oneOf(diagnosticSources.cohort, ["RETAINED_RUN_1_DATABASE_IDS", "NOT_AVAILABLE"])
    || diagnosticSources.demographics !== "CURRENT_MASTER_DATA" || diagnosticSources.eligibleFrame !== "NOT_RECORDED"
    || diagnosticSources.probabilitySampling !== "NOT_VERIFIED" || diagnosticSources.standardizedResponseRate !== "UNAVAILABLE" || diagnosticSources.surveyCompletion !== "UNAVAILABLE"
    || !oneOf(diagnosticSources.analysisBaseAlignment, ["MATCHED", "MISMATCH", "NOT_ASSESSED"])
    || !oneOf(diagnosticSources.outsideInitialCohort, ["NONE_OBSERVED", "OBSERVED", "NOT_ASSESSED"])
    || (diagnostics.status === "NOT_AVAILABLE") !== (diagnosticSources.cohort === "NOT_AVAILABLE")) fail();
  const stageKeys = ["SELECTED", "ATTEMPTED", "CONNECTED", "STRUCTURED_RECORD"];
  const stageTitles = ["Retained initial-cohort voter records", "Records with matched call executions", "Records with a matched connected call", "Records with connected structured data"];
  const outcomeKeys = ["STRUCTURED_RECORD", "PENDING", "CALLBACK_OR_RESULT_UNAVAILABLE", "CONNECTED_NO_RECORD", "BUSY", "NO_ANSWER", "PROVIDER_FAILED", "SUBMISSION_FAILED", "NOT_ATTEMPTED", "UNKNOWN"];
  const outcomeTitles = ["Connected structured record available", "Latest execution still open", "Callback or matched result unavailable", "Connected, without a structured record", "Latest matched result: busy", "Latest matched result: no answer", "Latest matched result: provider failure", "Submission failed without a provider attempt", "No matched execution recorded", "Observed state cannot be classified"];
  const partitionStatus = (item: unknown) => oneOf(item, ["AVAILABLE", "WITHHELD", "NOT_AVAILABLE"]);
  const safeCount = (item: unknown): item is number => number(item) && (item === 0 || item >= 5);
  const share = (item: unknown, part: number, base: number) => base === 0 ? item === null
    : typeof item === "number" && Number.isFinite(item) && item >= 0 && item <= 100 && Math.abs(item - 100 * part / base) <= 0.051;
  const coverage = object(diagnostics.coverage, ["status", "selectedBase", "stages", "yield"]);
  const outcomes = object(diagnostics.outcomes, ["status", "base", "rows"]);
  if (!partitionStatus(coverage.status) || !partitionStatus(outcomes.status) || coverage.status !== outcomes.status
    || !Array.isArray(coverage.stages) || coverage.stages.length !== stageKeys.length || !Array.isArray(outcomes.rows) || outcomes.rows.length !== outcomeKeys.length
    || (diagnostics.status === "NOT_AVAILABLE" && coverage.status !== "NOT_AVAILABLE")
    || (diagnostics.status === "WITHHELD" && coverage.status !== "WITHHELD")
    || (["AVAILABLE", "IN_PROGRESS"].includes(String(diagnostics.status)) && coverage.status !== "AVAILABLE")
    || (diagnostics.status === "AVAILABLE" && scope.fieldworkStatus !== "CLOSED")
    || (diagnostics.status === "IN_PROGRESS" && scope.fieldworkStatus !== "IN_PROGRESS")) fail();
  const available = coverage.status === "AVAILABLE";
  if (available ? !safeCount(coverage.selectedBase) || outcomes.base !== coverage.selectedBase
    : coverage.selectedBase !== null || outcomes.base !== null || coverage.yield !== null) fail();
  const stageCounts: number[] = [];
  for (const [index, item] of coverage.stages.entries()) {
    const row = object(item, ["key", "title", "participants", "percentage"]);
    if (row.key !== stageKeys[index] || row.title !== stageTitles[index]) fail();
    if (available) {
      if (!safeCount(row.participants) || !number(coverage.selectedBase) || !share(row.percentage, row.participants, coverage.selectedBase)
        || (index === 0 && row.participants !== coverage.selectedBase)
        || (index > 0 && (row.participants > stageCounts[index - 1] || !safeCount(stageCounts[index - 1] - row.participants)))
        || !safeCount(coverage.selectedBase - row.participants)) fail();
      stageCounts.push(row.participants);
    } else if (row.participants !== null || row.percentage !== null) fail();
  }
  let outcomeTotal = 0;
  for (const [index, item] of outcomes.rows.entries()) {
    const row = object(item, ["key", "title", "participants", "percentage"]);
    if (row.key !== outcomeKeys[index] || row.title !== outcomeTitles[index]) fail();
    if (available) {
      if (!safeCount(row.participants) || !number(outcomes.base) || !share(row.percentage, row.participants, outcomes.base)
        || !safeCount(outcomes.base - row.participants) || (index === 0 && row.participants !== stageCounts[3])) fail();
      outcomeTotal += row.participants;
    } else if (row.participants !== null || row.percentage !== null) fail();
  }
  if (available && outcomeTotal !== coverage.selectedBase) fail();
  if (available && coverage.selectedBase !== 0) {
    const yieldValue = object(coverage.yield, ["numerator", "denominator", "percentage", "label"]);
    if (yieldValue.numerator !== stageCounts[3] || yieldValue.denominator !== coverage.selectedBase
      || !number(yieldValue.numerator) || !number(yieldValue.denominator) || !share(yieldValue.percentage, yieldValue.numerator, yieldValue.denominator)
      || yieldValue.label !== "Connected structured-record yield (not a survey response rate)") fail();
  } else if (coverage.yield !== null) fail();
  const demographics = object(diagnostics.demographics, ["gender", "ageBand", "mandal"]);
  const categories: Record<string, string[]> = { gender: ["Female", "Male", "Other / self-described", "Unknown"], ageBand: ["18–29", "30–39", "40–49", "50+", "Unknown"] };
  for (const kind of ["gender", "ageBand", "mandal"]) {
    const partition = object(demographics[kind], ["status", "selectedBase", "structuredBase", "rows"]);
    if (!partitionStatus(partition.status) || !Array.isArray(partition.rows) || partition.rows.length > 2000
      || (!available && partition.status === "AVAILABLE")
      || (diagnostics.status === "NOT_AVAILABLE" && partition.status !== "NOT_AVAILABLE")
      || (diagnostics.status === "WITHHELD" && partition.status !== "WITHHELD")) fail();
    const partitionAvailable = partition.status === "AVAILABLE";
    if (partitionAvailable ? partition.selectedBase !== coverage.selectedBase || partition.structuredBase !== stageCounts[3]
      : partition.selectedBase !== null || partition.structuredBase !== null) fail();
    if (!partitionAvailable && partition.rows.length) fail();
    if (kind !== "mandal" && partitionAvailable && partition.rows.length !== categories[kind].length) fail();
    const seen = new Set<string>();
    let selectedTotal = 0, structuredTotal = 0;
    for (const [index, item] of partition.rows.entries()) {
      const row = object(item, ["category", "selected", "structured", "selectedPct", "structuredPct", "differencePp"]);
      if (!string(row.category, 160) || !row.category.trim() || seen.has(row.category)
        || (kind !== "mandal" && row.category !== categories[kind][index])
        || (kind === "mandal" && (/[\u0000-\u001f\u007f@<>]|:\/\/|\b[A-Z]{3}\d{7}\b|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i.test(row.category) || row.category.replace(/\D/g, "").length >= 8))) fail();
      seen.add(row.category);
      if (partitionAvailable) {
        if (!safeCount(row.selected) || !safeCount(row.structured) || row.structured > row.selected
          || (filters[kind] !== null && row.selected > 0 && row.category !== filters[kind])
          || !safeCount(row.selected - row.structured) || !number(partition.selectedBase) || !number(partition.structuredBase)
          || !safeCount(partition.selectedBase - row.selected) || !safeCount(partition.structuredBase - row.structured)
          || !share(row.selectedPct, row.selected, partition.selectedBase) || !share(row.structuredPct, row.structured, partition.structuredBase)
          || (row.selectedPct === null || row.structuredPct === null ? row.differencePp !== null
            : typeof row.differencePp !== "number" || !Number.isFinite(row.differencePp) || Math.abs(row.differencePp - (Number(row.structuredPct) - Number(row.selectedPct))) > 0.051)) fail();
        selectedTotal += row.selected; structuredTotal += row.structured;
      } else if (["selected", "structured", "selectedPct", "structuredPct", "differencePp"].some((key) => row[key] !== null)) fail();
    }
    if (partitionAvailable && (selectedTotal !== partition.selectedBase || structuredTotal !== partition.structuredBase)) fail();
  }
  if (!Array.isArray(root.checks) || root.checks.length < 1 || root.checks.length > 30) fail();
  for (const entry of root.checks) {
    const check = object(entry, ["id", "status", "message"]);
    if (!string(check.id, 100) || !string(check.status, 100) || !string(check.message)) fail();
  }
  if (!Array.isArray(root.reports) || root.reports.length < 1 || root.reports.length > 30) fail();
  for (const entry of root.reports) {
    const report = object(entry, ["id", "title", "definitionStatus", "captureStatus", "target", "outputVariables", "questionCodes", "answerBase", "codedBase", "respondentBase", "suppressed", "distribution", "message", "caution"]);
    if (!string(report.id, 100) || !string(report.title, 160) || !oneOf(report.definitionStatus, ["CONTRACT_RECORDED", "DEFINITION_ONLY", "INVALID_CONTRACT", "CONFLICTING_TARGETS", "UNSUPPORTED_MAPPING", "TARGET_REQUIRED", "UNCONFIGURED"])
      || !oneOf(report.captureStatus, ["DESCRIPTIVE_AVAILABLE", "NO_RECORDED_ANSWERS", "INSUFFICIENT_BASE", "SMALL_CELLS_WITHHELD", "MAPPING_PENDING", "NOT_MEASURED"])
      || !strings(report.outputVariables, 1000) || !strings(report.questionCodes, 1000)
      || !["answerBase", "codedBase", "respondentBase"].every((key) => nullableNumber(report[key]))
      || typeof report.suppressed !== "boolean" || !Array.isArray(report.distribution) || report.distribution.length > 40 || !string(report.message) || !string(report.caution)) fail();
    if (report.target !== null) {
      const target = object(report.target, ["type", "id", "name"]);
      if (!oneOf(target.type, ["PARTY", "CANDIDATE", "LEADER", "SCHEME"]) || !string(target.id, 160) || !string(target.name, 160)) fail();
    }
    let total = 0;
    for (const entry of report.distribution) {
      const row = object(entry, ["value", "respondents", "percentage"]);
      if (!string(row.value, 160) || !number(row.respondents) || row.respondents < 5
        || !(row.percentage === null || (typeof row.percentage === "number" && Number.isFinite(row.percentage) && row.percentage >= 0 && row.percentage <= 100))) fail();
      if (!number(report.answerBase) || report.answerBase < 5 || row.percentage === null
        || Math.abs(row.percentage - 100 * row.respondents / report.answerBase) > 0.051) fail();
      total += row.respondents;
    }
    if ((report.captureStatus === "DESCRIPTIVE_AVAILABLE") !== !report.suppressed
      || (number(report.codedBase) && number(report.answerBase) && report.codedBase > report.answerBase)) fail();
    if (report.suppressed && report.distribution.length) fail();
    if (!report.suppressed && (report.definitionStatus !== "CONTRACT_RECORDED" || report.captureStatus !== "DESCRIPTIVE_AVAILABLE" || !report.distribution.length || total !== report.answerBase
      || !number(report.answerBase) || report.answerBase < 5 || !number(report.codedBase) || report.codedBase < 5 || !number(report.respondentBase) || report.respondentBase < report.answerBase)) fail();
    if (available && diagnosticSources.analysisBaseAlignment === "MATCHED" && number(report.respondentBase) && report.respondentBase !== stageCounts[3]) fail();
  }
  if (!Array.isArray(root.findings) || root.findings.length > 30 || !strings(root.limitations) || !strings(root.nextActions)) fail();
  for (const entry of root.findings) {
    const finding = object(entry, ["reportKey", "type", "title", "answerBase", "caution"]);
    if (!string(finding.reportKey, 100) || finding.type !== "DESCRIPTIVE_DISTRIBUTION" || !string(finding.title, 160) || !number(finding.answerBase) || finding.answerBase < 5 || !string(finding.caution)) fail();
  }
  return value as ResearchReport;
}

export function researchStatusLabel(value: string | null | undefined) {
  return value ? value.toLowerCase().replaceAll("_", " ") : "Not recorded";
}

export function fieldworkValueLabel(value: number | null, status: FieldworkPartitionStatus, format: "count" | "percent" | "difference" = "count") {
  if (value === null) return status === "WITHHELD" ? "Withheld" : "Unavailable";
  if (format === "percent") return `${value.toFixed(1)}%`;
  if (format === "difference") return `${value > 0 ? "+" : ""}${value.toFixed(1)} pp`;
  return String(value);
}

function escapeHtml(value: unknown) {
  return String(value ?? "Not recorded").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[character] || character));
}

function displayDate(value: string | null) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not recorded" : date.toISOString();
}

// Portable, aggregate-only report. All interpolated content is escaped, and
// the file has no scripts, network assets, tracking or respondent-level rows.
export function buildPrintableResearchReport(report: ResearchReport) {
  const e = escapeHtml;
  const list = (items: string[]) => `<ul>${items.map((item) => `<li>${e(item)}</li>`).join("")}</ul>`;
  const field = (name: string, value: unknown) => `<dt>${e(name)}</dt><dd>${e(value)}</dd>`;
  const sections = report.reports.map((item) => {
    const distribution = item.suppressed || !item.distribution.length
      ? `<p>No reportable distribution. ${e(researchStatusLabel(item.captureStatus))}.</p>`
      : `<table><thead><tr><th>Recorded answer</th><th>Respondents</th><th>Share of answers</th></tr></thead><tbody>${item.distribution.map((row) => `<tr><td>${e(row.value)}</td><td>${e(row.respondents)}</td><td>${e(row.percentage === null ? "Withheld" : `${row.percentage.toFixed(1)}%`)}</td></tr>`).join("")}</tbody></table>`;
    return `<section class="report"><h2>${e(item.title)}</h2><p class="status">Definition: ${e(researchStatusLabel(item.definitionStatus))} · Capture: ${e(researchStatusLabel(item.captureStatus))}</p>${item.target?.name ? `<p>Target: ${e(item.target.name)} (${e(item.target.type)})</p>` : ""}<p>${e(item.message)}</p><p>Output variables: ${e(item.outputVariables.join(", ") || "Not defined")}</p><p>Answer base: ${e(item.answerBase)} · Respondent base: ${e(item.respondentBase)} · Coded base: ${e(item.codedBase)}</p>${distribution}<p class="note">${e(item.caution)}</p></section>`;
  }).join("");
  const provenance = [
    field("Iteration", report.scope.iterationNumber === null ? "No selected Iteration" : `Iteration ${report.scope.iterationNumber} · ${report.scope.iterationName || ""}`),
    field("Fieldwork", report.scope.fieldworkStatus === "IN_PROGRESS" ? "In progress — partial snapshot" : researchStatusLabel(report.scope.fieldworkStatus)),
    field("Run", report.scope.run ? `Run ${report.scope.run.number} · operations only` : "All Run operations"),
    field("Filters", Object.entries(report.scope.filters).map(([key, value]) => `${key}: ${value || "All"}`).join(" · ")),
    field("Generated (UTC)", displayDate(report.generatedAt)),
    field("Latest stored evidence (UTC)", displayDate(report.sources.latestEvidenceAt)),
    field("Questionnaire", `${report.sources.questionnaire.code || "Not recorded"} · version ${report.sources.questionnaire.version ?? "Not recorded"}`),
    field("Question content", researchStatusLabel(report.sources.questionnaire.status)),
    field("Question fingerprint", report.sources.questionnaire.contentFingerprint),
    field("Assigned agent snapshot", report.sources.voiceAgent ? `${report.sources.voiceAgent.appId || report.sources.voiceAgent.code || "Not recorded"} · version ${report.sources.voiceAgent.version ?? "Not recorded"}` : "Not recorded"),
    field("Normalization rules", report.sources.normalizationVersion),
    field("Normalization rule hash", report.sources.normalizationRuleHash)
  ].join("");
  const methods = [
    field("Actual-method declaration", researchStatusLabel(report.methodology.declarationStatus)),
    field("Declaration revision", report.methodology.revision),
    field("Declaration date (UTC)", displayDate(report.methodology.declaredAt)),
    field("Fieldwork mode", researchStatusLabel(report.methodology.fieldworkMode)),
    field("Sampling declared", researchStatusLabel(report.methodology.samplingMethod)),
    field("Cohort design", researchStatusLabel(report.methodology.cohortDesign)),
    field("Weighting engine", researchStatusLabel(report.methodology.weighting.status)),
    field("Representativeness", researchStatusLabel(report.methodology.representativeSampling)),
    field("Formal response rate", researchStatusLabel(report.methodology.standardizedResponseRate)),
    field("Human validation", researchStatusLabel(report.methodology.humanValidation)),
    field("Wave comparison", researchStatusLabel(report.methodology.comparison.status))
  ].join("");
  const diagnostics = report.fieldworkDiagnostics;
  const countLabel = (value: number | null, status: FieldworkPartitionStatus) => e(fieldworkValueLabel(value, status));
  const percentLabel = (value: number | null, status: FieldworkPartitionStatus) => e(fieldworkValueLabel(value, status, "percent"));
  const diagnosticSources = [
    field("Diagnostic status", researchStatusLabel(diagnostics.status)),
    field("Unavailable reason", diagnostics.reason === "NONE" ? "None recorded" : researchStatusLabel(diagnostics.reason)),
    field("Last stored cohort event (UTC)", displayDate(diagnostics.observedAt)),
    field("Cohort source", researchStatusLabel(diagnostics.sources.cohort)),
    field("Demographic source", "Current voter-master data; not frozen selection-time attributes"),
    field("Historical eligible frame", researchStatusLabel(diagnostics.sources.eligibleFrame)),
    field("Probability sampling", researchStatusLabel(diagnostics.sources.probabilitySampling)),
    field("Formal response rate", researchStatusLabel(diagnostics.sources.standardizedResponseRate)),
    field("Validated survey completions", researchStatusLabel(diagnostics.sources.surveyCompletion)),
    field("Analysis-base alignment", researchStatusLabel(diagnostics.sources.analysisBaseAlignment)),
    field("Contacts outside initial cohort", researchStatusLabel(diagnostics.sources.outsideInitialCohort))
  ].join("");
  const coverageTable = `<h3>Observed coverage stages</h3><p>Status: ${e(researchStatusLabel(diagnostics.coverage.status))} · Retained cohort base: ${countLabel(diagnostics.coverage.selectedBase, diagnostics.coverage.status)}</p><table><thead><tr><th>Stage</th><th>Unique database voter records</th><th>Share of retained cohort</th></tr></thead><tbody>${diagnostics.coverage.stages.map((row) => `<tr><th scope="row">${e(row.title)}</th><td>${countLabel(row.participants, diagnostics.coverage.status)}</td><td>${percentLabel(row.percentage, diagnostics.coverage.status)}</td></tr>`).join("")}</tbody></table><p>${diagnostics.coverage.yield ? `${e(diagnostics.coverage.yield.label)}: ${e(diagnostics.coverage.yield.numerator)} / ${e(diagnostics.coverage.yield.denominator)} (${percentLabel(diagnostics.coverage.yield.percentage, diagnostics.coverage.status)})` : `Structured-record yield: ${diagnostics.coverage.status === "AVAILABLE" && diagnostics.coverage.selectedBase === 0 ? "Not calculable (zero retained cohort)" : countLabel(null, diagnostics.coverage.status)}`}</p>`;
  const outcomesTable = `<h3>Observed operational outcomes</h3><p>Status: ${e(researchStatusLabel(diagnostics.outcomes.status))} · Retained cohort base: ${countLabel(diagnostics.outcomes.base, diagnostics.outcomes.status)}</p><table><thead><tr><th>Outcome</th><th>Unique database voter records</th><th>Share of retained cohort</th></tr></thead><tbody>${diagnostics.outcomes.rows.map((row) => `<tr><th scope="row">${e(row.title)}</th><td>${countLabel(row.participants, diagnostics.outcomes.status)}</td><td>${percentLabel(row.percentage, diagnostics.outcomes.status)}</td></tr>`).join("")}</tbody></table>`;
  const compositionTables = (["gender", "ageBand", "mandal"] as const).map((key) => {
    const partition = diagnostics.demographics[key];
    const name = key === "ageBand" ? "Age band" : key === "mandal" ? "Mandal" : "Gender";
    return `<h3>${name} composition</h3><p>Status: ${e(researchStatusLabel(partition.status))} · Retained cohort: ${countLabel(partition.selectedBase, partition.status)} · Connected structured records: ${countLabel(partition.structuredBase, partition.status)}</p>${partition.rows.length ? `<table><thead><tr><th>Category</th><th>Retained cohort</th><th>Cohort share</th><th>Structured records</th><th>Structured share</th><th>Composition difference</th></tr></thead><tbody>${partition.rows.map((row) => `<tr><th scope="row">${e(row.category)}</th><td>${countLabel(row.selected, partition.status)}</td><td>${percentLabel(row.selectedPct, partition.status)}</td><td>${countLabel(row.structured, partition.status)}</td><td>${percentLabel(row.structuredPct, partition.status)}</td><td>${e(fieldworkValueLabel(row.differencePp, partition.status, "difference"))}</td></tr>`).join("")}</tbody></table>` : `<p>${partition.status === "WITHHELD" ? "Whole composition partition withheld; category labels and complementary values are not disclosed." : partition.status === "AVAILABLE" ? "No retained records in this filtered cohort." : "Composition source unavailable."}</p>`}`;
  }).join("");
  const fieldworkSection = `<section><h2>Contact cohort and response coverage</h2><p>Counts are distinct database voter IDs retained in Run 1 across all retry Runs, not verified unique people. These are operational observations, not an eligible electoral frame, representative sample, AAPOR response rate or validated interview completions.</p><dl>${diagnosticSources}</dl>${coverageTable}${outcomesTable}<p>Composition compares current-master attributes for the retained cohort and its connected structured-record subset. Differences are percentage points, not electorate bias estimates. Zero is an observed count; unavailable and withheld values are not zero.</p>${compositionTables}<h3>Coverage limitations</h3>${list(diagnostics.limitations)}<h3>Coverage next actions</h3>${list(diagnostics.nextActions)}</section>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${e(report.campaign.name)} — Research report</title>
<style>body{font:15px/1.6 system-ui,sans-serif;color:#253b36;max-width:1000px;margin:40px auto;padding:0 24px}h1{line-height:1.2}h2{font-size:20px;margin-top:28px}.banner{border:1px solid #cfddd8;padding:18px;background:#f5faf7}.report{border-top:1px solid #cfddd8;padding:10px 0;break-inside:avoid}.status,.note{font-size:13px;color:#52655e}dl{display:grid;grid-template-columns:210px 1fr;gap:6px 20px}dt{font-weight:650}dd{margin:0;overflow-wrap:anywhere}table{width:100%;border-collapse:collapse;margin:15px 0}th,td{text-align:left;border-bottom:1px solid #d9e3df;padding:8px}footer{font-size:12px;overflow-wrap:anywhere;margin-top:30px}@media(max-width:600px){dl{grid-template-columns:1fr;gap:0}dd{margin-bottom:12px}}@media print{body{margin:0;font-size:11pt}.banner{background:white}h2{break-after:avoid}}</style></head><body>
<header><p>PSEPHOLOGY · VERSIONED RESEARCH REPORT</p><h1>${e(report.campaign.name)}</h1><p>${e(report.campaign.code)} · ${e(report.scope.description)}</p></header>
<aside class="banner"><strong>Descriptive responding-cohort evidence — not an election forecast.</strong><p>Definitions, captured answers and research validation are separate. Missing or withheld values are never replaced with zero. This report is not a human sign-off.</p></aside>
<h2>Scope and provenance</h2><dl>${provenance}</dl><h2>Methodology and validation</h2><dl>${methods}</dl>${list(report.methodology.comparison.reasons)}
<h2>Research checks</h2>${list(report.checks.map((check) => `${researchStatusLabel(check.status)} — ${check.message}`))}${fieldworkSection}${sections}
<h2>Limitations</h2>${list(report.limitations)}<h2>Next research actions</h2>${list(report.nextActions)}
<footer>Schema ${e(report.schemaVersion)} · Rules ${e(report.rulesVersion)}<br>Report ID: ${e(report.reportId)}<br>Research payload SHA-256: ${e(report.checksum)}<br>This identifies the canonical JSON research payload, not the HTML or PDF file. It is not an independent certification, digital signature or guarantee of survey validity. No respondent identities, contact numbers or transcripts are included.</footer></body></html>`;
}
