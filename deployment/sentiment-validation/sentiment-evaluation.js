import * as shared from '../output-variable-standardization/output-normalization.repository.js';
import { createHash } from 'node:crypto';

export const REVIEW_SCHEMA = 'DEMO_SENTIMENT_REVIEW_V1';
const LANGUAGES = new Set(['EN', 'TE', 'HI', 'MIXED']);
const ORIGINS = new Set(['SYNTHETIC', 'SANITIZED_CALL']);
const TYPES = new Set(['NORMALIZATION_MAPPING', 'RECORDED_PROVIDER_OUTPUT']);
const STATUS_LABELS = new Map([
  ['MISSING', null], ['CANT_SAY', "Can't say"], ['REFUSED', 'Declined to answer'], ['UNCODED', 'Uncoded response']
]);
const SENTIMENT_LABELS = new Set(['Positive', 'Negative', 'Neutral', 'Mixed']);
const FIT_LABELS = new Set(['Strong fit', 'Some fit', 'Poor fit', 'Mixed']);
const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_-]{1,99}$/;
const SENSITIVE_TEXT = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b|(?:\+?\d[ ().-]*){9,}\d/i;

function fail(message) { throw new Error(`Invalid sentiment review dataset: ${message}`); }
const identifier = (value) => typeof value === 'string' && IDENTIFIER.test(value) && !SENSITIVE_TEXT.test(value);
function object(value, allowed, required, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${label}.${key} is not an allowed field`);
  for (const key of required) if (!Object.hasOwn(value, key)) fail(`${label}.${key} is required`);
}
function text(value, maximum, label, nullable = false) {
  if (nullable && value === null) return;
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) fail(`${label} must be nonempty text of at most ${maximum} characters`);
  if (SENSITIVE_TEXT.test(value)) fail(`${label} contains a possible contact or source identifier; sanitize it manually`);
}
function metadata() {
  if (!Array.isArray(shared.SENTIMENT_CONSTRUCTS) || !shared.SENTIMENT_CONSTRUCTS.length) {
    throw new Error('Shared SENTIMENT_CONSTRUCTS metadata is required; install the matching local normalization source');
  }
  if (typeof shared.SENTIMENT_RULESET_HASH !== 'string' || !/^[0-9a-f]{64}$/.test(shared.SENTIMENT_RULESET_HASH)) {
    throw new Error('Shared SENTIMENT_RULESET_HASH is required to bind this report to the rules and implementation');
  }
  return new Map(shared.SENTIMENT_CONSTRUCTS.map((construct) => [construct.key, construct]));
}
function reference(value, construct, label) {
  object(value, ['status', 'label'], ['status', 'label'], label);
  if (value.status === 'CODED') {
    if (!(construct.type === 'SUITABILITY' ? FIT_LABELS : SENTIMENT_LABELS).has(value.label)) {
      fail(`${label} is not a category for ${construct.key}; suitability and sentiment cannot be pooled`);
    }
  } else if (!STATUS_LABELS.has(value.status) || STATUS_LABELS.get(value.status) !== value.label) {
    fail(`${label} has an unsupported status/label pair`);
  }
}
function reviewer(value, construct, label) {
  if (value === null) return;
  object(value, ['reviewerReference', 'identityKind', 'confirmedHuman', 'signedAt', 'evidenceReference', 'label', 'note'],
    ['reviewerReference', 'identityKind', 'confirmedHuman', 'signedAt', 'evidenceReference', 'label', 'note'], label);
  if (!identifier(value.reviewerReference)) fail(`${label}.reviewerReference must be a pseudonymous review reference`);
  if (!['HUMAN_DECLARED', 'AUTO'].includes(value.identityKind) || typeof value.confirmedHuman !== 'boolean') fail(`${label} must declare its reviewer kind and confirmation`);
  if (value.signedAt !== null && (typeof value.signedAt !== 'string'
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value.signedAt)
      || !Number.isFinite(Date.parse(value.signedAt))
      || new Date(value.signedAt).toISOString().replace('.000Z', 'Z') !== value.signedAt.replace('.000Z', 'Z'))) fail(`${label}.signedAt must be a valid UTC timestamp or null`);
  text(value.evidenceReference, 200, `${label}.evidenceReference`, true);
  text(value.note, 500, `${label}.note`);
  reference(value.label, construct, `${label}.label`);
}
function signedHuman(value) {
  return value?.identityKind === 'HUMAN_DECLARED' && value.confirmedHuman === true
    && typeof value.signedAt === 'string' && typeof value.evidenceReference === 'string';
}
const signature = (value) => `${value.status}:${value.label ?? 'NO_RECORDED_OUTPUT'}`;

export function validateReviewDataset(dataset) {
  const constructs = metadata();
  object(dataset, ['schemaVersion', 'datasetReference', 'title', 'cases'], ['schemaVersion', 'datasetReference', 'title', 'cases'], 'dataset');
  if (dataset.schemaVersion !== REVIEW_SCHEMA) fail(`schemaVersion must be ${REVIEW_SCHEMA}`);
  if (!identifier(dataset.datasetReference)) fail('datasetReference must be a technical, nonpersonal reference');
  text(dataset.title, 200, 'title');
  if (!Array.isArray(dataset.cases) || !dataset.cases.length || dataset.cases.length > 2000) fail('cases must contain 1–2000 samples');
  const ids = new Set();
  for (const item of dataset.cases) {
    object(item, ['id', 'origin', 'language', 'construct', 'outputKey', 'evaluationType', 'family', 'questionText', 'sourceExcerpt', 'providerOutput', 'authoredExpectation', 'sanitization', 'review'],
      ['id', 'origin', 'language', 'construct', 'outputKey', 'evaluationType', 'family', 'questionText', 'sourceExcerpt', 'providerOutput', 'authoredExpectation', 'sanitization', 'review'], 'case');
    if (!identifier(item.id) || ids.has(item.id)) fail('case.id must be a unique technical sample reference, never a call/voter ID');
    ids.add(item.id);
    if (!ORIGINS.has(item.origin) || !LANGUAGES.has(item.language) || !TYPES.has(item.evaluationType)) fail(`${item.id} has an unsupported origin/language/evaluationType`);
    const construct = constructs.get(item.construct);
    if (!construct || !construct.outputKeys.includes(item.outputKey)) fail(`${item.id}.outputKey must belong to its declared construct; awareness is not sentiment`);
    if (!identifier(item.family)) fail(`${item.id}.family must be a technical test-family reference`);
    text(item.questionText, 500, `${item.id}.questionText`);
    text(item.sourceExcerpt, 1000, `${item.id}.sourceExcerpt`, true);
    if (item.providerOutput !== null && !['string', 'number', 'boolean'].includes(typeof item.providerOutput)) fail(`${item.id}.providerOutput must be a recorded scalar or null, not a source record`);
    if (typeof item.providerOutput === 'string') {
      if (item.providerOutput.length > 500 || SENSITIVE_TEXT.test(item.providerOutput)) fail(`${item.id}.providerOutput needs manual sanitization or is too long`);
    }
    if (typeof item.providerOutput === 'number' && !Number.isFinite(item.providerOutput)) fail(`${item.id}.providerOutput must be finite`);
    if (item.origin === 'SYNTHETIC') {
      reference(item.authoredExpectation, construct, `${item.id}.authoredExpectation`);
      if (item.sanitization !== null) fail(`${item.id}: synthetic samples do not assert real-call sanitization`);
    } else {
      if (item.authoredExpectation !== null) fail(`${item.id}: a sanitized call cannot use an authored/automatic expectation as human gold`);
      if (item.evaluationType !== 'RECORDED_PROVIDER_OUTPUT') fail(`${item.id}: real samples must evaluate the actual recorded provider output`);
      if (item.sourceExcerpt === null && shared.normalizeOutputValue(item.outputKey, item.providerOutput).status !== 'MISSING') fail(`${item.id}: a recorded assessment requires its manually sanitized response excerpt`);
      object(item.sanitization, ['manuallySanitized', 'confirmedNoPersonalIdentifiers'], ['manuallySanitized', 'confirmedNoPersonalIdentifiers'], `${item.id}.sanitization`);
      if (item.sanitization.manuallySanitized !== true || item.sanitization.confirmedNoPersonalIdentifiers !== true) fail(`${item.id}: manual sanitization and removal of personal identifiers must be explicitly confirmed`);
    }
    object(item.review, ['state', 'reviewer1', 'reviewer2', 'adjudication'], ['state', 'reviewer1', 'reviewer2', 'adjudication'], `${item.id}.review`);
    if (!['UNREVIEWED', 'REVIEW_IN_PROGRESS', 'REVIEW_DECLARED_COMPLETE'].includes(item.review.state)) fail(`${item.id}.review.state is unsupported`);
    for (const key of ['reviewer1', 'reviewer2', 'adjudication']) reviewer(item.review[key], construct, `${item.id}.review.${key}`);
  }
  return dataset;
}

export function reviewReference(item) {
  if (item.origin === 'SYNTHETIC') return {
    status: 'HUMAN_REVIEW_PENDING', source: 'AUTHORED_SYNTHETIC_EXPECTATION', label: item.authoredExpectation,
    reason: 'Authored contract expectation; not a human-validated real-call reference'
  };
  const { state, reviewer1, reviewer2, adjudication } = item.review;
  const pending = (reason) => ({ status: 'HUMAN_REVIEW_PENDING', source: null, label: null, reason });
  if (state !== 'REVIEW_DECLARED_COMPLETE') return pending('The sample has not declared review completion');
  if (!signedHuman(reviewer1) || !signedHuman(reviewer2)) return pending('Two signed, human-confirmed review declarations and evidence references are required; AUTO does not qualify');
  if (reviewer1.reviewerReference === reviewer2.reviewerReference) return pending('The two reviews must have distinct references');
  const disagree = signature(reviewer1.label) !== signature(reviewer2.label);
  if (disagree && (!signedHuman(adjudication) || [reviewer1.reviewerReference, reviewer2.reviewerReference].includes(adjudication.reviewerReference))) {
    return pending('Review disagreement requires a distinct signed human-confirmed adjudicator and rationale');
  }
  if (!disagree && adjudication && signature(adjudication.label) !== signature(reviewer1.label)) {
    return pending('A conflicting adjudication requires the reviewer disagreement and resolution to be documented');
  }
  return {
    status: 'HUMAN_REVIEW_ATTESTED_UNVERIFIED', source: disagree ? 'ATTESTED_ADJUDICATION' : 'ATTESTED_DUAL_REVIEW',
    label: disagree ? adjudication.label : reviewer1.label,
    reason: 'Signed review and reviewer identity are declared by the input author; this offline tool does not verify identity, independence or evidence authenticity'
  };
}

export function evaluateSentimentDataset(dataset, options = {}) {
  validateReviewDataset(dataset);
  const constructs = metadata();
  const rows = dataset.cases.map((item) => {
    const normalized = shared.normalizeOutputValue(item.outputKey, item.providerOutput);
    const ref = reviewReference(item);
    const allowed = constructs.get(item.construct).type === 'SUITABILITY' ? FIT_LABELS : SENTIMENT_LABELS;
    const contractValid = normalized.status === 'CODED' ? allowed.has(normalized.label)
      : STATUS_LABELS.has(normalized.status) && STATUS_LABELS.get(normalized.status) === normalized.label;
    return {
      id: item.id, origin: item.origin, language: item.language, construct: item.construct,
      evaluationType: item.evaluationType, family: item.family,
      normalized: { status: normalized.status, label: normalized.label, domain: normalized.domain },
      referenceSource: ref.source, referenceLabel: ref.label, reviewStatus: ref.status, reviewReason: ref.reason,
      contractValid, matchesReference: ref.label ? signature(normalized) === signature(ref.label) : null
    };
  });
  const strata = [];
  for (const language of LANGUAGES) for (const construct of constructs.values()) {
    const selected = rows.filter((row) => row.language === language && row.construct === construct.key);
    const compared = selected.filter((row) => row.matchesReference !== null);
    const nonmissing = selected.filter((row) => row.normalized.status !== 'MISSING');
    const coded = selected.filter((row) => row.contractValid && row.normalized.status === 'CODED');
    const counts = { CODED: 0, MISSING: 0, CANT_SAY: 0, REFUSED: 0, UNCODED: 0, INVALID_CONTRACT_OUTPUT: 0 };
    const confusionMatrix = {};
    for (const row of selected) {
      counts[row.contractValid ? row.normalized.status : 'INVALID_CONTRACT_OUTPUT']++;
      if (row.referenceLabel) {
        const expected = signature(row.referenceLabel), actual = signature(row.normalized);
        confusionMatrix[expected] ||= {};
        confusionMatrix[expected][actual] = (confusionMatrix[expected][actual] || 0) + 1;
      }
    }
    const synthetic = compared.filter((row) => row.origin === 'SYNTHETIC');
    const attested = compared.filter((row) => row.origin === 'SANITIZED_CALL');
    strata.push({
      language, construct: construct.key, constructType: construct.type, caseCount: selected.length,
      evaluationTypeCounts: Object.fromEntries([...TYPES].map((type) => [type, selected.filter((row) => row.evaluationType === type).length])),
      outputStateCounts: counts, recordedNonmissingBase: nonmissing.length,
      codedCoverage: nonmissing.length ? coded.length / nonmissing.length : null,
      classifierAbstentionCount: counts.UNCODED, classifierAbstentionRate: nonmissing.length ? counts.UNCODED / nonmissing.length : null,
      syntheticCompared: synthetic.length, syntheticContractMatches: synthetic.filter((row) => row.matchesReference).length,
      syntheticContractAgreement: synthetic.length ? synthetic.filter((row) => row.matchesReference).length / synthetic.length : null,
      attestedReferenceCompared: attested.length, attestedReferenceMatches: attested.filter((row) => row.matchesReference).length,
      attestedReferenceAgreement: attested.length ? attested.filter((row) => row.matchesReference).length / attested.length : null,
      sanitizedCallCount: selected.filter((row) => row.origin === 'SANITIZED_CALL').length,
      attestedSanitizedCallCount: attested.length,
      pendingSanitizedCallCount: selected.filter((row) => row.origin === 'SANITIZED_CALL' && row.reviewStatus === 'HUMAN_REVIEW_PENDING').length,
      humanReviewPending: selected.filter((row) => row.reviewStatus === 'HUMAN_REVIEW_PENDING').length,
      confusionMatrix
    });
  }
  const mismatches = rows.filter((row) => row.matchesReference === false || !row.contractValid);
  const pendingReal = rows.filter((row) => row.origin === 'SANITIZED_CALL' && row.reviewStatus === 'HUMAN_REVIEW_PENDING');
  const realCallCoverageGaps = strata.filter((stratum) => stratum.attestedSanitizedCallCount === 0).map((stratum) => ({
    language: stratum.language, construct: stratum.construct,
    sanitizedCallCount: stratum.sanitizedCallCount, pendingSanitizedCallCount: stratum.pendingSanitizedCallCount,
    attestedSanitizedCallCount: 0,
    reason: 'No declared dual-reviewed or adjudicated sanitized real-call reference is available for this stratum'
  }));
  return {
    reportSchemaVersion: 'DEMO_SENTIMENT_EVALUATION_V1', datasetReference: dataset.datasetReference,
    datasetHash: createHash('sha256').update(JSON.stringify(dataset)).digest('hex'),
    datasetHashBasis: 'JSON.stringify of the validated input object, including supplied outputs and review declarations',
    generatedAt: options.generatedAt || new Date().toISOString(),
    normalizationVersion: shared.NORMALIZATION_VERSION, rulesetHash: shared.SENTIMENT_RULESET_HASH,
    scope: 'Offline demonstration engineering checks and declared review-label agreement; no model is called',
    limits: [
      'Synthetic expectations are authored tests, not human-validated language accuracy or a representative dataset',
      'Recorded provider output is evaluated as supplied; this tool does not run or validate provider extraction',
      'Human identity, independence, signing and evidence authenticity cannot be verified by this offline evaluator',
      'Uncertainty, refusal, missing output and classifier abstention are separate states; no individual political trait is inferred',
      'Constructs are reported separately; candidate suitability is not candidate sentiment',
      'A report cannot activate approval, validate sentiment accuracy or approve a deployment'
    ],
    reviewStatus: rows.some((row) => row.reviewStatus === 'HUMAN_REVIEW_ATTESTED_UNVERIFIED')
      ? 'HUMAN_REVIEW_ATTESTED_UNVERIFIED' : 'HUMAN_REVIEW_PENDING',
    engineeringGate: mismatches.length ? 'FAIL' : 'PASS',
    humanReviewGate: pendingReal.length ? 'INCOMPLETE_DECLARATIONS' : rows.some((row) => row.origin === 'SANITIZED_CALL')
      ? 'ATTESTED_REVIEW_NOT_INDEPENDENTLY_VERIFIED' : 'HUMAN_REVIEW_PENDING',
    stratifiedReviewStatus: realCallCoverageGaps.length || pendingReal.length
      ? 'HUMAN_REVIEW_PENDING' : 'ATTESTED_COVERAGE_NOT_INDEPENDENTLY_VERIFIED',
    stratifiedReviewBasis: 'All language/construct cells are disclosed. Nonzero declared review coverage is not a sample-size sufficiency threshold, accuracy validation or deployment approval.',
    deploymentApproval: 'NOT_GRANTED_BY_EVALUATOR',
    totals: { caseCount: rows.length, mismatchCount: mismatches.length,
      syntheticCount: rows.filter((row) => row.origin === 'SYNTHETIC').length,
      sanitizedCallCount: rows.filter((row) => row.origin === 'SANITIZED_CALL').length,
      attestedSanitizedCallCount: rows.filter((row) => row.origin === 'SANITIZED_CALL' && row.reviewStatus === 'HUMAN_REVIEW_ATTESTED_UNVERIFIED').length,
      pendingSanitizedCallCount: pendingReal.length, realCallCoverageGapCount: realCallCoverageGaps.length },
    strata, realCallCoverageGaps, mismatches, cases: rows
  };
}
