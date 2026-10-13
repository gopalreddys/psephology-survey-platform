export const qualityChecks = [
  ["greetingFlow", "Greeting and turn progression"],
  ["questionDelivery", "Required question delivery"],
  ["languageHandling", "Language handling"],
  ["neutrality", "Neutral question delivery"],
  ["outputExtraction", "Answers match extracted outputs"],
  ["missingStateHandling", "Missing / refused answers handled correctly"]
] as const;
export const qualityIssueBuckets = [
  ["GREETING_LOOP", "Greeting / name-validation loop"],
  ["QUESTION_SKIPPED", "Required question skipped"],
  ["LANGUAGE_HANDLING", "Language handling"],
  ["OUTPUT_MISMATCH", "Transcript / output mismatch"],
  ["MISSING_STATE_ERROR", "Missing-state handling"],
  ["LEADING_QUESTION", "Leading or persuasive question"],
  ["OTHER", "Other diagnostic issue"]
] as const;
export const qualityLanguages = ["TELUGU", "ENGLISH", "HINDI", "MIXED", "OTHER"] as const;
export type QualityCheck = typeof qualityChecks[number][0];
export type QualityCheckResult = "PASS" | "FAIL" | "NOT_ASSESSABLE";
export type QualityLanguage = typeof qualityLanguages[number];
export type QualityIssue = typeof qualityIssueBuckets[number][0];
export type QualityReview = {
  id: string; language: QualityLanguage; checks: Record<QualityCheck, QualityCheckResult>;
  issueBuckets: QualityIssue[]; note: string; createdAt: string;
};
export type CallQualityEvidence = {
  schemaVersion: 1; executionId: string; campaignId: string; iterationId: string; runId: string;
  evidenceFingerprint: string | null; reviewable: boolean; approvalReady: boolean; blockedReasons: string[];
  evidence: {
    transcript: unknown[]; outputs: Record<string, unknown>;
    questions: Array<{ code: string; text: string; order: number; outputVariables: string[] }>;
    agent: { appId: string | null; version: number | null; basis: "EXECUTION_REQUEST" | "NOT_RECORDED" };
    frozenInstrumentHash: string | null; normalizationRuleHash: string | null;
  };
  permissions: { canReview: boolean; canDecide: boolean };
  ownReview: QualityReview | null; reviews: QualityReview[];
  decision: { revision: number; action: "APPROVE_SAMPLE" | "REJECT_SAMPLE"; reason: string; decidedAt: string; evidenceFingerprint: string } | null;
  counts: { currentReviews: number; staleReviews: number }; decisionRevision: number;
};
export type CallQualitySummary = {
  schemaVersion: 1; campaignId: string; iterationId: string;
  status: "PENDING" | "REVIEW_IN_PROGRESS" | "SAMPLE_APPROVED_PARTIAL" | "CHANGES_REQUIRED" | "STALE" | "NOT_AVAILABLE";
  counts: { reviewableCalls: number; reviewedCalls: number; approvedCalls: number; rejectedCalls: number; staleCalls: number };
  latestDecisionAt: string | null; limitations: string[];
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hash = /^[a-f0-9]{64}$/;
const fail = (): never => { throw new Error("Call-quality evidence could not be verified. No review or approval is assumed."); };
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== keys.length || keys.some((key) => !Object.hasOwn(row, key))) return fail();
  return row;
}
function text(value: unknown, max = 1000): string {
  if (typeof value !== "string" || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) return fail();
  return value;
}
function id(value: unknown): string { if (typeof value !== "string" || !uuid.test(value)) return fail(); return value; }
function count(value: unknown): number { if (!Number.isSafeInteger(value) || Number(value) < 0) return fail(); return Number(value); }
function bool(value: unknown): boolean { if (typeof value !== "boolean") return fail(); return value; }
function fingerprint(value: unknown, nullable = true): string | null { if (nullable && value === null) return null; if (typeof value !== "string" || !hash.test(value)) return fail(); return value; }
function date(value: unknown): string { if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) return fail(); return value; }
function choice<T extends string>(value: unknown, values: readonly T[]): T { if (typeof value !== "string" || !values.includes(value as T)) return fail(); return value as T; }
function strings(value: unknown, max = 1000, limit = 100): string[] { if (!Array.isArray(value) || value.length > limit) return fail(); return value.map((item) => text(item, max)); }
function review(value: unknown): QualityReview {
  const row = record(value, ["id", "language", "checks", "issueBuckets", "note", "createdAt"]);
  const checks = record(row.checks, qualityChecks.map(([key]) => key));
  const parsedChecks = Object.fromEntries(qualityChecks.map(([key]) => [key, choice(checks[key], ["PASS", "FAIL", "NOT_ASSESSABLE"])])) as Record<QualityCheck, QualityCheckResult>;
  const issues = strings(row.issueBuckets, 60, qualityIssueBuckets.length).map((item) => choice(item, qualityIssueBuckets.map(([key]) => key)));
  if (new Set(issues).size !== issues.length) return fail();
  return { id: id(row.id), language: choice(row.language, qualityLanguages), checks: parsedChecks, issueBuckets: issues, note: text(row.note), createdAt: date(row.createdAt) };
}

export function parseCallQualityEvidence(value: unknown, executionId: string, expectedScope?: { campaignId: string; iterationId: string; runId: string }): CallQualityEvidence {
  const row = record(value, ["schemaVersion", "executionId", "campaignId", "iterationId", "runId", "evidenceFingerprint", "reviewable", "approvalReady", "blockedReasons", "evidence", "permissions", "ownReview", "reviews", "decision", "counts", "decisionRevision"]);
  if (row.schemaVersion !== 1 || row.executionId !== executionId) return fail();
  const campaignId = id(row.campaignId), iterationId = id(row.iterationId), runId = id(row.runId);
  if (expectedScope && (campaignId !== expectedScope.campaignId || iterationId !== expectedScope.iterationId || runId !== expectedScope.runId)) return fail();
  const evidence = record(row.evidence, ["transcript", "outputs", "questions", "agent", "frozenInstrumentHash", "normalizationRuleHash"]);
  if (!Array.isArray(evidence.transcript) || evidence.transcript.length > 10000 || !evidence.outputs || typeof evidence.outputs !== "object" || Array.isArray(evidence.outputs) || !Array.isArray(evidence.questions) || evidence.questions.length > 1000) return fail();
  const questions = evidence.questions.map((item) => {
    const question = record(item, ["code", "text", "order", "outputVariables"]);
    const outputVariables = strings(question.outputVariables, 80, 100);
    if (outputVariables.some((key) => !/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/.test(key)) || new Set(outputVariables).size !== outputVariables.length) return fail();
    if (!count(question.order)) return fail();
    return { code: text(question.code, 160), text: text(question.text, 10000), order: count(question.order), outputVariables };
  });
  if (new Set(questions.map((question) => question.code)).size !== questions.length) return fail();
  const agent = record(evidence.agent, ["appId", "version", "basis"]);
  const parsedAgent = { appId: agent.appId === null ? null : text(agent.appId, 200), version: agent.version === null ? null : count(agent.version), basis: choice(agent.basis, ["EXECUTION_REQUEST", "NOT_RECORDED"]) };
  if (parsedAgent.version === 0) return fail();
  const permissions = record(row.permissions, ["canReview", "canDecide"]);
  const counts = record(row.counts, ["currentReviews", "staleReviews"]);
  if (!Array.isArray(row.reviews) || row.reviews.length > 1000) return fail();
  const reviews = row.reviews.map(review);
  const ownReview = row.ownReview === null ? null : review(row.ownReview);
  if (new Set(reviews.map((item) => item.id)).size !== reviews.length || (!ownReview && reviews.length)) return fail();
  const currentReviews = count(counts.currentReviews), staleReviews = count(counts.staleReviews);
  if (currentReviews > 2 || reviews.length + (ownReview ? 1 : 0) > currentReviews || reviews.some((item) => item.id === ownReview?.id)) return fail();
  const decisionRevision = count(row.decisionRevision);
  let decision: CallQualityEvidence["decision"] = null;
  if (row.decision !== null) {
    const item = record(row.decision, ["revision", "action", "reason", "decidedAt", "evidenceFingerprint"]);
    decision = { revision: count(item.revision), action: choice(item.action, ["APPROVE_SAMPLE", "REJECT_SAMPLE"]), reason: text(item.reason), decidedAt: date(item.decidedAt), evidenceFingerprint: fingerprint(item.evidenceFingerprint, false)! };
    if (decision.revision !== decisionRevision || !decisionRevision) return fail();
  }
  const evidenceFingerprint = fingerprint(row.evidenceFingerprint), reviewable = bool(row.reviewable), approvalReady = bool(row.approvalReady);
  const frozenInstrumentHash = fingerprint(evidence.frozenInstrumentHash), normalizationRuleHash = fingerprint(evidence.normalizationRuleHash);
  const blockedReasons = strings(row.blockedReasons);
  const canReview = bool(permissions.canReview), canDecide = bool(permissions.canDecide);
  if (ownReview && (canReview || canDecide) || canReview && canDecide || !reviewable && (canReview || canDecide)) return fail();
  if (canReview && currentReviews >= 2) return fail();
  if (ownReview && !currentReviews) return fail();
  if (approvalReady && !ownReview && permissions.canReview === true) return fail();
  if (approvalReady && reviews.some((item) => item.issueBuckets.length || qualityChecks.some(([key]) => item.checks[key] !== "PASS"))) return fail();
  if (approvalReady && ownReview && (ownReview.issueBuckets.length || qualityChecks.some(([key]) => ownReview.checks[key] !== "PASS"))) return fail();
  if (reviewable && !evidenceFingerprint) return fail();
  if (approvalReady && (!reviewable || blockedReasons.length || currentReviews < 2 || !questions.length || !frozenInstrumentHash || !normalizationRuleHash || parsedAgent.basis !== "EXECUTION_REQUEST" || !parsedAgent.appId || !parsedAgent.version)) return fail();
  return { schemaVersion: 1, executionId: id(row.executionId), campaignId, iterationId, runId, evidenceFingerprint, reviewable, approvalReady, blockedReasons,
    evidence: { transcript: evidence.transcript, outputs: evidence.outputs as Record<string, unknown>, questions, agent: parsedAgent, frozenInstrumentHash, normalizationRuleHash },
    permissions: { canReview, canDecide }, ownReview, reviews, decision, counts: { currentReviews, staleReviews }, decisionRevision };
}

export function parseCallQualitySummary(value: unknown, campaignId: string, iterationId: string): CallQualitySummary {
  const row = record(value, ["schemaVersion", "campaignId", "iterationId", "status", "counts", "latestDecisionAt", "limitations"]);
  if (row.schemaVersion !== 1 || row.campaignId !== campaignId || row.iterationId !== iterationId) return fail();
  id(row.campaignId); id(row.iterationId);
  const counts = record(row.counts, ["reviewableCalls", "reviewedCalls", "approvedCalls", "rejectedCalls", "staleCalls"]);
  const parsedCounts = Object.fromEntries(Object.entries(counts).map(([key, value]) => [key, count(value)])) as CallQualitySummary["counts"];
  const status = choice(row.status, ["PENDING", "REVIEW_IN_PROGRESS", "SAMPLE_APPROVED_PARTIAL", "CHANGES_REQUIRED", "STALE", "NOT_AVAILABLE"]);
  const latestDecisionAt = row.latestDecisionAt === null ? null : date(row.latestDecisionAt);
  if (parsedCounts.approvedCalls > parsedCounts.reviewedCalls || parsedCounts.reviewedCalls > parsedCounts.reviewableCalls) return fail();
  const expectedStatus = parsedCounts.rejectedCalls ? "CHANGES_REQUIRED" : parsedCounts.staleCalls ? "STALE" : parsedCounts.approvedCalls ? "SAMPLE_APPROVED_PARTIAL" : parsedCounts.reviewedCalls ? "REVIEW_IN_PROGRESS" : "PENDING";
  if (status === "NOT_AVAILABLE" ? Object.values(parsedCounts).some((value) => value !== 0) || latestDecisionAt !== null : status !== expectedStatus) return fail();
  return { schemaVersion: 1, campaignId, iterationId, status, counts: parsedCounts, latestDecisionAt, limitations: strings(row.limitations, 2000) };
}

export function qualityLabel(value: string): string { return value.toLowerCase().replaceAll("_", " "); }
export function qualityNoteError(value: string, required = false): string | null {
  const trimmed = value.trim();
  if (required && !trimmed) return "Enter a diagnostic reason without personal details.";
  if (trimmed.length > 1000) return "Keep the note within 1,000 characters.";
  if (/[\u0000-\u001f\u007f]/.test(trimmed) || /[\w.+-]+@[\w.-]+\.[a-z]{2,}|\b(?:\+?\d[\s().-]*){7,}\b|\b[0-9a-f]{8}-[0-9a-f-]{27,}\b|https?:\/\//i.test(trimmed)) return "Remove phone numbers, email addresses, IDs and links from the note.";
  return null;
}
