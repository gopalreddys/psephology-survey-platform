export const interviewCompletionStates = [
  "COMPLETE_RECORDED", "PARTIAL_RECORDED", "NO_SUBSTANTIVE_RECORD", "TECHNICALLY_UNRESOLVED",
  "NOT_CONNECTED", "IN_PROGRESS", "NOT_ATTEMPTED"
] as const;
export type InterviewCompletionState = typeof interviewCompletionStates[number];
export const interviewCompletionLabels: Record<InterviewCompletionState, string> = {
  COMPLETE_RECORDED: "Complete recorded coverage", PARTIAL_RECORDED: "Partial recorded coverage",
  NO_SUBSTANTIVE_RECORD: "No substantive record", TECHNICALLY_UNRESOLVED: "Technically unresolved",
  NOT_CONNECTED: "Not connected", IN_PROGRESS: "In progress", NOT_ATTEMPTED: "Not attempted"
};
export const interviewCompletionCountLabels = [
  ["completeRecorded", "Complete recorded coverage"], ["partialRecorded", "Partial recorded coverage"],
  ["noSubstantiveRecord", "No substantive record"], ["technicallyUnresolved", "Technically unresolved"],
  ["notConnected", "Not connected"], ["inProgress", "In progress"], ["notAttempted", "Not attempted"]
] as const;
const summaryReasons = ["RECORDED_COVERAGE_AVAILABLE", "SMALL_CELL_PARTITION_WITHHELD", "NO_SELECTED_ITERATION", "RETAINED_BASE_COHORT_UNAVAILABLE", "AMBIGUOUS_SOURCE_SCOPE", "SOURCE_SCHEMA_UNAVAILABLE"] as const;
const questionStates = ["SUBSTANTIVE", "CANT_SAY", "REFUSED", "MISSING", "NOT_REQUIRED", "UNRESOLVED"] as const;
const coverageKeys = ["requiredQuestions", "accountedQuestions", "substantiveQuestions", "missingQuestions", "cantSayQuestions", "refusedQuestions"] as const;
const countKeys = ["selectedBase", ...interviewCompletionCountLabels.map(([key]) => key)] as const;
type Coverage = Record<typeof coverageKeys[number], number | null>;
export type InterviewCompletionDetail = {
  schemaVersion: 1; rulesVersion: "INTERVIEW_COMPLETENESS_V1";
  executionId: string; campaignId: string; iterationId: string; runId: string;
  status: InterviewCompletionState; reasonCodes: string[];
  source: { frozenInstrumentHash: string | null; evidenceFingerprint: string | null; observedAt: string | null; validation: "AUTOMATED_COVERAGE_ONLY" };
  coverage: Coverage;
  questions: Array<{ code: string; required: boolean; status: typeof questionStates[number]; mappedOutputs: number }>;
  limitations: string[];
};
export type InterviewCompletionSummary = {
  schemaVersion: 1; rulesVersion: "INTERVIEW_COMPLETENESS_V1"; campaignId: string; iterationId: string | null;
  status: "AVAILABLE" | "WITHHELD" | "NOT_AVAILABLE"; reason: typeof summaryReasons[number]; observedAt: string | null;
  source: { cohort: "RETAINED_RUN_1_DATABASE_IDS" | "NOT_AVAILABLE"; attemptSelection: "LATEST_MATCHED_EXECUTION_ACROSS_ALL_RUNS"; validation: "AUTOMATED_COVERAGE_ONLY"; frozenInstrumentHash: string | null };
  counts: Record<typeof countKeys[number], number | null>; limitations: string[];
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hash = /^[a-f0-9]{64}$/;
const fail = (): never => { throw new Error("Recorded interview coverage could not be verified. No completion or zero count is assumed."); };
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== keys.length || keys.some((key) => !Object.hasOwn(row, key))) return fail();
  return row;
}
function text(value: unknown, max = 2000): string {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) return fail();
  return value;
}
function id(value: unknown): string { if (typeof value !== "string" || !uuid.test(value)) return fail(); return value; }
function count(value: unknown): number { if (!Number.isSafeInteger(value) || Number(value) < 0) return fail(); return Number(value); }
function nullableCount(value: unknown): number | null { return value === null ? null : count(value); }
function fingerprint(value: unknown): string | null { if (value === null) return null; if (typeof value !== "string" || !hash.test(value)) return fail(); return value; }
function date(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) return fail();
  return value;
}
function choice<T extends string>(value: unknown, values: readonly T[]): T { if (typeof value !== "string" || !values.includes(value as T)) return fail(); return value as T; }
function strings(value: unknown, max = 2000, limit = 100): string[] { if (!Array.isArray(value) || value.length > limit) return fail(); return value.map((item) => text(item, max)); }
function version(row: Record<string, unknown>) { if (row.schemaVersion !== 1 || row.rulesVersion !== "INTERVIEW_COMPLETENESS_V1") return fail(); }

export function parseInterviewCompletionDetail(value: unknown, expected: { executionId: string; campaignId: string; iterationId: string; runId: string }): InterviewCompletionDetail {
  const row = record(value, ["schemaVersion", "rulesVersion", "executionId", "campaignId", "iterationId", "runId", "status", "reasonCodes", "source", "coverage", "questions", "limitations"]);
  version(row);
  const ids = { executionId: id(row.executionId), campaignId: id(row.campaignId), iterationId: id(row.iterationId), runId: id(row.runId) };
  if (Object.entries(ids).some(([key, value]) => value !== expected[key as keyof typeof expected])) return fail();
  const status = choice(row.status, interviewCompletionStates);
  const source = record(row.source, ["frozenInstrumentHash", "evidenceFingerprint", "observedAt", "validation"]);
  const parsedSource = { frozenInstrumentHash: fingerprint(source.frozenInstrumentHash), evidenceFingerprint: fingerprint(source.evidenceFingerprint), observedAt: date(source.observedAt), validation: choice(source.validation, ["AUTOMATED_COVERAGE_ONLY"]) };
  const rawCoverage = record(row.coverage, coverageKeys);
  const coverage = Object.fromEntries(coverageKeys.map((key) => [key, nullableCount(rawCoverage[key])])) as Coverage;
  const available = coverageKeys.every((key) => coverage[key] !== null);
  if (!available && coverageKeys.some((key) => coverage[key] !== null)) return fail();
  if (!Array.isArray(row.questions) || row.questions.length > 500) return fail();
  const questions = row.questions.map((value) => {
    const item = record(value, ["code", "required", "status", "mappedOutputs"]);
    if (typeof item.required !== "boolean") return fail();
    const result = { code: text(item.code, 160), required: item.required, status: choice(item.status, questionStates), mappedOutputs: count(item.mappedOutputs) };
    if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(result.code)) return fail();
    if (result.mappedOutputs > 50) return fail();
    if (result.required && (result.status === "NOT_REQUIRED" || result.mappedOutputs === 0) || !result.required && result.status !== "NOT_REQUIRED") return fail();
    return result;
  });
  if (new Set(questions.map((item) => item.code.toUpperCase())).size !== questions.length) return fail();
  if (available) {
    const required = questions.filter((item) => item.required);
    if (coverage.requiredQuestions !== required.length || !required.length || required.some((item) => item.status === "UNRESOLVED")) return fail();
    for (const [key, state] of [["substantiveQuestions", "SUBSTANTIVE"], ["cantSayQuestions", "CANT_SAY"], ["refusedQuestions", "REFUSED"], ["missingQuestions", "MISSING"]] as const) if (coverage[key] !== required.filter((item) => item.status === state).length) return fail();
    if (coverage.accountedQuestions !== coverage.substantiveQuestions! + coverage.cantSayQuestions! + coverage.refusedQuestions! || coverage.requiredQuestions !== coverage.accountedQuestions! + coverage.missingQuestions!) return fail();
  } else if (questions.length) return fail();
  if (available && !["COMPLETE_RECORDED", "PARTIAL_RECORDED", "NO_SUBSTANTIVE_RECORD"].includes(status)) return fail();
  if (status === "NO_SUBSTANTIVE_RECORD" && available && coverage.substantiveQuestions !== 0) return fail();
  if (status === "COMPLETE_RECORDED" && (!available || !coverage.substantiveQuestions || coverage.missingQuestions !== 0 || !parsedSource.frozenInstrumentHash || !parsedSource.evidenceFingerprint || !parsedSource.observedAt)) return fail();
  if (status === "PARTIAL_RECORDED" && (!available || !coverage.missingQuestions || !parsedSource.frozenInstrumentHash || !parsedSource.evidenceFingerprint || !parsedSource.observedAt)) return fail();
  const reasonCodes = strings(row.reasonCodes, 160);
  if (reasonCodes.some((code) => !/^[A-Z][A-Z0-9_]*$/.test(code)) || new Set(reasonCodes).size !== reasonCodes.length) return fail();
  const reasonsByState: Partial<Record<InterviewCompletionState, readonly string[]>> = {
    COMPLETE_RECORDED: ["ALL_REQUIRED_OUTPUTS_ACCOUNTED"], PARTIAL_RECORDED: ["REQUIRED_OUTPUTS_MISSING"],
    NO_SUBSTANTIVE_RECORD: ["RECORDED_PARTICIPATION_DENIED", "NO_SUBSTANTIVE_REQUIRED_OUTPUT"],
    NOT_CONNECTED: ["RECORDED_NON_CONNECTION"], IN_PROGRESS: ["EXECUTION_ACTIVE"], NOT_ATTEMPTED: ["NO_MATCHED_EXECUTION"]
  };
  if (!reasonCodes.length || reasonsByState[status] && (reasonCodes.length !== 1 || !reasonsByState[status]!.includes(reasonCodes[0]))) return fail();
  if (status === "NO_SUBSTANTIVE_RECORD" && ((reasonCodes[0] === "RECORDED_PARTICIPATION_DENIED" && available) || (reasonCodes[0] === "NO_SUBSTANTIVE_REQUIRED_OUTPUT" && !available))) return fail();
  if (status === "TECHNICALLY_UNRESOLVED" && reasonCodes.some((code) => Object.values(reasonsByState).some((reasons) => reasons.includes(code)))) return fail();
  return { schemaVersion: 1, rulesVersion: "INTERVIEW_COMPLETENESS_V1", ...ids, status, reasonCodes, source: parsedSource, coverage, questions, limitations: strings(row.limitations) };
}

export function parseInterviewCompletionSummary(value: unknown, campaignId: string, iterationId: string): InterviewCompletionSummary {
  const row = record(value, ["schemaVersion", "rulesVersion", "campaignId", "iterationId", "status", "reason", "observedAt", "source", "counts", "limitations"]);
  version(row);
  if (id(row.campaignId) !== campaignId || id(row.iterationId) !== iterationId) return fail();
  const status = choice(row.status, ["AVAILABLE", "WITHHELD", "NOT_AVAILABLE"]);
  const reason = choice(row.reason, summaryReasons);
  const source = record(row.source, ["cohort", "attemptSelection", "validation", "frozenInstrumentHash"]);
  const parsedSource = { cohort: choice(source.cohort, ["RETAINED_RUN_1_DATABASE_IDS", "NOT_AVAILABLE"]), attemptSelection: choice(source.attemptSelection, ["LATEST_MATCHED_EXECUTION_ACROSS_ALL_RUNS"]), validation: choice(source.validation, ["AUTOMATED_COVERAGE_ONLY"]), frozenInstrumentHash: fingerprint(source.frozenInstrumentHash) };
  const rawCounts = record(row.counts, countKeys);
  const counts = Object.fromEntries(countKeys.map((key) => [key, nullableCount(rawCounts[key])])) as InterviewCompletionSummary["counts"];
  if (status === "AVAILABLE") {
    if (reason !== "RECORDED_COVERAGE_AVAILABLE" || parsedSource.cohort !== "RETAINED_RUN_1_DATABASE_IDS" || countKeys.some((key) => counts[key] === null)) return fail();
    if (interviewCompletionCountLabels.reduce((sum, [key]) => sum + counts[key]!, 0) !== counts.selectedBase) return fail();
    if (interviewCompletionCountLabels.some(([key]) => counts[key]! > 0 && counts[key]! < 5)) return fail();
    if ((counts.completeRecorded! > 0 || counts.partialRecorded! > 0) && !parsedSource.frozenInstrumentHash) return fail();
  } else {
    if (countKeys.some((key) => counts[key] !== null)) return fail();
    if (status === "WITHHELD" && (reason !== "SMALL_CELL_PARTITION_WITHHELD" || parsedSource.cohort !== "RETAINED_RUN_1_DATABASE_IDS")) return fail();
    if (status === "NOT_AVAILABLE" && (reason === "RECORDED_COVERAGE_AVAILABLE" || reason === "SMALL_CELL_PARTITION_WITHHELD" || parsedSource.cohort !== "NOT_AVAILABLE")) return fail();
  }
  return { schemaVersion: 1, rulesVersion: "INTERVIEW_COMPLETENESS_V1", campaignId, iterationId, status, reason, observedAt: date(row.observedAt), source: parsedSource, counts, limitations: strings(row.limitations) };
}

export function interviewReasonLabel(value: string): string { return value.toLowerCase().replaceAll("_", " "); }
