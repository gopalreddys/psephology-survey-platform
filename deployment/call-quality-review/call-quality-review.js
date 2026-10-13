import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const CHECK_KEYS = ['greetingFlow', 'questionDelivery', 'languageHandling', 'neutrality', 'outputExtraction', 'missingStateHandling'];
export const LANGUAGES = ['TELUGU', 'ENGLISH', 'HINDI', 'MIXED', 'OTHER'];
export const CHECK_STATES = ['PASS', 'FAIL', 'NOT_ASSESSABLE'];
export const ISSUE_BUCKETS = ['GREETING_LOOP', 'QUESTION_SKIPPED', 'LANGUAGE_HANDLING', 'OUTPUT_MISMATCH', 'MISSING_STATE_ERROR', 'LEADING_QUESTION', 'OTHER'];
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const HASH = /^[a-f0-9]{64}$/;
export const object = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
export class CallQualityError extends Error {
  constructor(message, code = 'INVALID_CALL_QUALITY_INPUT', statusCode = 400) { super(message); this.code = code; this.statusCode = statusCode; }
}
export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}
export const fingerprint = (value) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export function normalizationRulesHash() {
  try {
    // Re-read bytes, rather than a module-cached constant, on every evidence load.
    return createHash('sha256').update(readFileSync(new URL('./normalization-rules.json', import.meta.url)))
      .update('\n').update(readFileSync(new URL('./output-normalization.repository.js', import.meta.url))).digest('hex');
  } catch { return null; }
}
export function authorize(actor, roles = ['SUPER_ADMIN', 'ADMIN']) {
  if (typeof actor?.id !== 'string' || !UUID.test(actor.id) || !roles.includes(actor?.role_code)) {
    throw new CallQualityError('This role cannot access call-quality review', 'CALL_QUALITY_FORBIDDEN', 403);
  }
}
export function validId(value) {
  if (typeof value !== 'string' || !UUID.test(value)) throw new CallQualityError('A valid resource ID is required');
  return value.toLowerCase();
}
function exactKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !keys.includes(key))
    || keys.some((key) => !Object.hasOwn(value, key))) throw new CallQualityError('Required fields are missing or unsupported fields were supplied');
}
function sanitizedNote(value, required = false) {
  if (typeof value !== 'string' || value.length > 1000 || (required && !value.trim()) || /[\u0000-\u001f\u007f]|(?:https?:\/\/|www\.)/i.test(value)
    || /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(value)
    || /(?:\b(?:\+?\d[\s().-]*){7,}\b)|(?:[A-Z]{3}\d{7})|(?:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i.test(value)) {
    throw new CallQualityError('Use a short sanitized note without contact details or source identifiers');
  }
  return value.trim();
}
function attest(body) {
  if (body.attested !== true) throw new CallQualityError('Reviewer attestation is required');
  if (!HASH.test(body.expectedEvidenceFingerprint || '')) throw new CallQualityError('A current evidence fingerprint is required');
}
export function validateReview(body) {
  exactKeys(body, ['expectedEvidenceFingerprint', 'language', 'checks', 'issueBuckets', 'note', 'attested']); attest(body);
  exactKeys(body.checks, CHECK_KEYS);
  if (!LANGUAGES.includes(body.language) || CHECK_KEYS.some((key) => !CHECK_STATES.includes(body.checks[key]))) throw new CallQualityError('Review language or check state is invalid');
  if (!Array.isArray(body.issueBuckets) || body.issueBuckets.length > ISSUE_BUCKETS.length
    || new Set(body.issueBuckets).size !== body.issueBuckets.length || body.issueBuckets.some((bucket) => !ISSUE_BUCKETS.includes(bucket))) throw new CallQualityError('Issue categories are invalid');
  return { ...body, checks: Object.fromEntries(CHECK_KEYS.map((key) => [key, body.checks[key]])), issueBuckets: [...body.issueBuckets].sort(), note: sanitizedNote(body.note) };
}
export function validateDecision(body) {
  exactKeys(body, ['expectedEvidenceFingerprint', 'expectedDecisionRevision', 'action', 'reason', 'attested']); attest(body);
  if (!['APPROVE_SAMPLE', 'REJECT_SAMPLE'].includes(body.action) || !Number.isSafeInteger(body.expectedDecisionRevision) || body.expectedDecisionRevision < 0) throw new CallQualityError('Decision action or revision is invalid');
  return { ...body, reason: sanitizedNote(body.reason, true) };
}
const date = (value) => value && Number.isFinite(new Date(value).getTime()) ? new Date(value).toISOString() : null;
const outputKeys = (value) => Array.isArray(value) ? [...new Set(value.map((item) => typeof item === 'string' ? item : object(item).key || object(item).name)
  .filter((key) => typeof key === 'string' && key.length <= 80 && /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/.test(key)))] : [];
function frozenInstrument(snapshot, questionnaireId) {
  const instrument = object(snapshot), questions = Array.isArray(instrument.questions) ? instrument.questions : [];
  const validQuestions = questions.length > 0 && questions.every((question) => typeof question?.question_code === 'string'
    && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(question.question_code) && typeof question.question_text === 'string'
    && question.question_text.trim().length > 0 && question.question_text.length <= 10000
    && Number.isSafeInteger(question.question_order) && question.question_order > 0)
    && new Set(questions.map((question) => question.question_code.toUpperCase())).size === questions.length
    && new Set(questions.map((question) => question.question_order)).size === questions.length;
  const valid = UUID.test(instrument.id || '') && instrument.id === questionnaireId && typeof instrument.code === 'string'
    && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(instrument.code) && Number.isSafeInteger(instrument.version) && instrument.version > 0
    && instrument.snapshot_schema_version === 2 && instrument.question_provenance === 'FROZEN_AT_SELECTION'
    && validQuestions && HASH.test(instrument.content_fingerprint || '') && instrument.content_fingerprint === fingerprint(questions);
  return { valid, hash: valid ? instrument.content_fingerprint : null,
    questions: validQuestions ? questions.map((question) => ({ code: question.question_code, text: question.question_text,
      order: question.question_order, outputVariables: [...new Set([...outputKeys(question.output_variables), ...outputKeys(question.outputVariables),
        ...outputKeys(object(question.metadata).output_variables), ...outputKeys(object(question.metadata).outputVariables)])] })).sort((a, b) => a.order - b.order) : [] };
}
function transcriptTurn(value) {
  if (typeof value === 'string' && value.trim()) return { speaker: 'Turn', text: value };
  const item = object(value), raw = item.content ?? item.text ?? item.message ?? item.transcript ?? item.utterance;
  const text = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw.map((block) => typeof block === 'string' ? block : object(block).text || '').join(' ') : '';
  if (!text.trim()) return null;
  return { speaker: String(item.role || item.speaker || item.participant || item.source || 'Turn').slice(0, 80), text };
}
export function evaluateEvidence(row, ruleHash) {
  const instrument = frozenInstrument(row.questionnaire_snapshot, row.questionnaire_id);
  const request = object(row.request_payload), deployment = object(request.providerDeployment);
  const appId = typeof deployment.app_id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(deployment.app_id) ? deployment.app_id : null;
  const version = Number(deployment.app_version);
  const appVersion = (typeof deployment.app_version === 'number' || /^\d+$/.test(deployment.app_version || '')) && Number.isSafeInteger(version) && version > 0 ? version : null;
  const transcript = Array.isArray(row.interaction_transcript) ? row.interaction_transcript.map(transcriptTurn).filter(Boolean) : [];
  const rawOutputs = object(row.response_variables), keys = new Set(instrument.questions.flatMap((question) => question.outputVariables));
  // Only frozen instrument keys enter the reviewer display; arbitrary provider
  // metadata (including contact/name fields) stays outside this DTO.
  const outputs = Object.fromEntries(Object.entries(rawOutputs).filter(([key]) => keys.has(key))
    .map(([key, value]) => [key, value === null || ['string', 'number', 'boolean'].includes(typeof value) ? value : '[Unsupported structured output shape]']));
  const providerIdentityRecorded = typeof row.provider_attempt_id === 'string' && row.provider_attempt_id.trim().length > 0;
  const identityValid = providerIdentityRecorded && Number(row.call_count) === 1 && Number(row.identity_conflicts) === 0 && Boolean(row.call_id);
  const reviewable = identityValid && row.connectivity_status?.trim().toLowerCase() === 'connected'
    && ['COMPLETED', 'FAILED'].includes(row.execution_status) && Boolean(row.callback_received_at) && transcript.length > 0;
  const blockedReasons = [];
  if (!identityValid) blockedReasons.push('MATCHED_CALL_IDENTITY_REQUIRED');
  if (!reviewable && identityValid) blockedReasons.push('RESOLVED_CONNECTED_TRANSCRIPT_REQUIRED');
  if (!instrument.valid) blockedReasons.push('VERIFIED_FROZEN_INSTRUMENT_REQUIRED');
  if (!keys.size || instrument.questions.some((question) => {
    const original = object(row.questionnaire_snapshot).questions?.find((item) => item.question_code === question.code);
    return object(original?.metadata).required_for_completion === true && !question.outputVariables.length;
  })) blockedReasons.push('FROZEN_OUTPUT_MAPPING_REQUIRED');
  if (!Object.keys(outputs).length) blockedReasons.push('STRUCTURED_OUTPUT_RECORD_REQUIRED');
  if (!appId || !appVersion) blockedReasons.push('EXECUTION_DEPLOYMENT_REQUIRED');
  if (!HASH.test(ruleHash || '')) blockedReasons.push('NORMALIZATION_RULE_HASH_REQUIRED');
  if (Object.entries(rawOutputs).some(([key, value]) => keys.has(key) && value !== null && !['string', 'number', 'boolean'].includes(typeof value))) blockedReasons.push('OUTPUT_VALUE_SHAPE_UNSUPPORTED');
  const evidence = { transcript: identityValid ? transcript : [], outputs: identityValid ? outputs : {}, questions: instrument.questions,
    agent: { appId, version: appVersion, basis: appId && appVersion ? 'EXECUTION_REQUEST' : 'NOT_RECORDED' },
    frozenInstrumentHash: instrument.hash, normalizationRuleHash: HASH.test(ruleHash || '') ? ruleHash : null };
  const evidenceFingerprint = reviewable ? fingerprint({ bindingVersion: 'CALL_QUALITY_EVIDENCE_V1',
    executionId: row.execution_id, campaignId: row.campaign_id, iterationId: row.iteration_id, runId: row.run_id,
    contactId: row.run_contact_id, voterId: row.voter_id, providerAttemptId: row.provider_attempt_id, callId: row.call_id,
    executionStatus: row.execution_status, callbackReceivedAt: date(row.callback_received_at),
    connectivity: row.connectivity_status, rawTranscript: row.interaction_transcript, rawOutputs: row.response_variables,
    rawRequest: row.request_payload, frozenQuestionnaire: row.questionnaire_snapshot,
    questionnaireId: row.questionnaire_id, normalizationRuleHash: evidence.normalizationRuleHash }) : null;
  return { evidence, evidenceFingerprint, reviewable, sourceReady: reviewable && blockedReasons.length === 0, blockedReasons };
}
function reviewDto(row) {
  return { id: row.id, language: row.language, checks: row.checks, issueBuckets: row.issue_buckets, note: row.note, createdAt: date(row.created_at) };
}
export function buildReviewDetail(row, actor, reviewRows, decisionRows, ruleHash) {
  const actorId = String(actor.id).toLowerCase();
  const source = evaluateEvidence(row, ruleHash);
  const retainedCurrent = reviewRows.filter((review) => review.evidence_fingerprint === source.evidenceFingerprint);
  const current = reviewRows.filter((review) => review.evidence_fingerprint === source.evidenceFingerprint && review.eligible !== false);
  const stale = reviewRows.filter((review) => review.evidence_fingerprint !== source.evidenceFingerprint || review.eligible === false);
  const own = current.find((review) => String(review.actor_user_id).toLowerCase() === actorId);
  const distinctReviewers = new Set(current.map((review) => String(review.actor_user_id).toLowerCase()));
  const allPassed = current.every((review) => CHECK_KEYS.every((key) => review.checks?.[key] === 'PASS') && review.issue_buckets?.length === 0);
  const hasDecided = decisionRows.some((decision) => String(decision.actor_user_id).toLowerCase() === actorId && decision.evidence_fingerprint === source.evidenceFingerprint);
  const hasCurrentDecision = decisionRows.some((decision) => decision.evidence_fingerprint === source.evidenceFingerprint);
  // Slots never reopen for evidence that was already unblinded to an actor:
  // deactivation/removal of one reviewer's current permission does not erase a
  // previously recorded review or permit a new biased replacement assessment.
  const canReview = source.reviewable && !own && retainedCurrent.length < 2 && !hasDecided && !hasCurrentDecision;
  const maySeeAssessment = Boolean(own) || !canReview;
  const approvalReady = maySeeAssessment && source.sourceReady && distinctReviewers.size >= 2 && allPassed;
  const blockedReasons = [...source.blockedReasons];
  if (distinctReviewers.size < 2) blockedReasons.push('TWO_INDEPENDENT_REVIEWS_REQUIRED');
  if (maySeeAssessment && current.length && !allPassed) blockedReasons.push('ALL_CHECKS_MUST_PASS_WITHOUT_ISSUES');
  const latest = [...decisionRows].sort((a, b) => b.revision - a.revision)[0] || null;
  return { schemaVersion: 1, executionId: row.execution_id, campaignId: row.campaign_id, iterationId: row.iteration_id, runId: row.run_id,
    evidenceFingerprint: source.evidenceFingerprint, reviewable: source.reviewable, approvalReady, blockedReasons, evidence: source.evidence,
    permissions: { canReview, canDecide: source.reviewable && retainedCurrent.length >= 2 && !retainedCurrent.some((review) => String(review.actor_user_id).toLowerCase() === actorId) },
    ownReview: own ? reviewDto(own) : null,
    reviews: own ? current.filter((review) => String(review.actor_user_id).toLowerCase() !== actorId).map(reviewDto) : [],
    decision: latest && !canReview ? { revision: latest.revision, action: latest.action, reason: latest.reason, decidedAt: date(latest.decided_at), evidenceFingerprint: latest.evidence_fingerprint } : null,
    counts: { currentReviews: current.length, staleReviews: stale.length }, decisionRevision: latest?.revision || 0 };
}
export function unavailableSummary(campaignId, iterationId) {
  return { schemaVersion: 1, campaignId, iterationId, status: 'NOT_AVAILABLE', counts: { reviewableCalls: 0, reviewedCalls: 0, approvedCalls: 0, rejectedCalls: 0, staleCalls: 0 },
    latestDecisionAt: null, limitations: ['Call-quality review source or selected Iteration is unavailable; zero counts do not certify no outstanding work.', 'Research and sentiment validation remain pending.'] };
}
export function buildReviewSummary(campaignId, iterationId, sourceRows, reviews, decisions, ruleHash) {
  const counts = { reviewableCalls: 0, reviewedCalls: 0, approvedCalls: 0, rejectedCalls: 0, staleCalls: 0 };
  let latestDecisionAt = null;
  for (const row of sourceRows) {
    const evidence = evaluateEvidence(row, ruleHash), sampleReviews = reviews.filter((item) => item.execution_id === row.execution_id);
    const sampleDecisions = decisions.filter((item) => item.execution_id === row.execution_id).sort((a, b) => b.revision - a.revision);
    const currentReviews = sampleReviews.filter((item) => item.evidence_fingerprint === evidence.evidenceFingerprint && item.eligible !== false);
    const latest = sampleDecisions[0];
    if (evidence.reviewable) counts.reviewableCalls++;
    if (currentReviews.length) counts.reviewedCalls++;
    // Re-evaluate positive prerequisites and reviewers, not merely the action.
    const eligibleApproval = evidence.sourceReady && new Set(currentReviews.map((item) => String(item.actor_user_id).toLowerCase())).size >= 2
      && currentReviews.every((item) => CHECK_KEYS.every((key) => item.checks?.[key] === 'PASS') && item.issue_buckets?.length === 0)
      && !currentReviews.some((item) => String(item.actor_user_id).toLowerCase() === String(latest?.actor_user_id).toLowerCase());
    if (latest?.evidence_fingerprint === evidence.evidenceFingerprint && evidence.reviewable && latest.eligible !== false) {
      if (latest.action === 'REJECT_SAMPLE') counts.rejectedCalls++;
      else if (eligibleApproval) counts.approvedCalls++;
      else counts.staleCalls++;
    } else if (latest || (sampleReviews.length && !currentReviews.length)
      || sampleReviews.some((item) => item.evidence_fingerprint === evidence.evidenceFingerprint && item.eligible === false)) counts.staleCalls++;
    const decidedAt = date(latest?.decided_at);
    if (decidedAt && (!latestDecisionAt || decidedAt > latestDecisionAt)) latestDecisionAt = decidedAt;
  }
  const sourceIds = new Set(sourceRows.map((row) => row.execution_id));
  counts.staleCalls += new Set([...reviews, ...decisions].filter((item) => !sourceIds.has(item.execution_id)).map((item) => item.execution_id)).size;
  const status = counts.rejectedCalls ? 'CHANGES_REQUIRED' : counts.staleCalls ? 'STALE'
    : counts.approvedCalls ? 'SAMPLE_APPROVED_PARTIAL' : counts.reviewedCalls ? 'REVIEW_IN_PROGRESS' : 'PENDING';
  return { schemaVersion: 1, campaignId, iterationId, status, counts, latestDecisionAt,
    limitations: ['Approval covers only the specifically reviewed call-quality samples, not the whole Iteration or a representative sample.',
      'This is operational call-quality review, not independently blinded construct-level linguistic sentiment validation.',
      'Research and sentiment validation remain pending; connected calls are not automatically complete interviews.'] };
}
