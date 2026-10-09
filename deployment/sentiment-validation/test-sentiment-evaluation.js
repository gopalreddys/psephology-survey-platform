import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NORMALIZATION_VERSION, SENTIMENT_RULESET_HASH, SENTIMENT_CONSTRUCTS } from '../output-variable-standardization/output-normalization.repository.js';
import { evaluateSentimentDataset, validateReviewDataset } from './sentiment-evaluation.js';
import { runEvaluationCli } from './evaluate-sentiment.js';
import { SYNTHETIC_BENCHMARK } from './synthetic-fixtures.js';

const fixedTime = '2026-10-09T00:00:00Z';
const clone = (value) => JSON.parse(JSON.stringify(value));
const oneCase = () => ({ ...clone(SYNTHETIC_BENCHMARK), cases: [clone(SYNTHETIC_BENCHMARK.cases[0])] });
const before = JSON.stringify(SYNTHETIC_BENCHMARK);
const report = evaluateSentimentDataset(SYNTHETIC_BENCHMARK, { generatedAt: fixedTime });
assert.equal(report.normalizationVersion, NORMALIZATION_VERSION);
assert.equal(report.rulesetHash, SENTIMENT_RULESET_HASH);
const ruleBytes = await readFile(new URL('../output-variable-standardization/normalization-rules.json', import.meta.url));
const implementationBytes = await readFile(new URL('../output-variable-standardization/output-normalization.repository.js', import.meta.url));
assert.equal(SENTIMENT_RULESET_HASH, createHash('sha256').update(ruleBytes).update('\n').update(implementationBytes).digest('hex'), 'binding covers both rule source and implementation bytes');
assert.notEqual(SENTIMENT_RULESET_HASH, createHash('sha256').update(ruleBytes).update('\n').update(implementationBytes).update('changed').digest('hex'), 'changed implementation cannot retain the evaluated binding');
assert.equal(report.datasetHash, createHash('sha256').update(before).digest('hex'), 'the report binds the supplied input and review declarations');
assert.equal(report.engineeringGate, 'PASS', JSON.stringify(report.mismatches));
assert.equal(report.reviewStatus, 'HUMAN_REVIEW_PENDING');
assert.equal(report.humanReviewGate, 'HUMAN_REVIEW_PENDING');
assert.equal(report.deploymentApproval, 'NOT_GRANTED_BY_EVALUATOR');
assert.equal(report.totals.syntheticCount, report.totals.caseCount);
assert.equal(report.totals.sanitizedCallCount, 0);
assert.equal(report.strata.length, 4 * SENTIMENT_CONSTRUCTS.length);
assert.equal(report.totals.attestedSanitizedCallCount, 0);
assert.equal(report.realCallCoverageGaps.length, 24);
assert.equal(report.stratifiedReviewStatus, 'HUMAN_REVIEW_PENDING');
assert.equal(JSON.stringify(SYNTHETIC_BENCHMARK), before, 'immutable input is not rewritten');
for (const stratum of report.strata) {
  assert.equal(stratum.attestedReferenceCompared, 0);
  assert.ok(stratum.outputStateCounts.MISSING > 0);
  assert.ok(stratum.outputStateCounts.CANT_SAY > 0);
  assert.ok(stratum.outputStateCounts.REFUSED > 0);
  assert.ok(stratum.outputStateCounts.UNCODED > 0);
  assert.equal(stratum.syntheticContractAgreement, 1);
  assert.ok(stratum.confusionMatrix['CODED:Mixed']);
  if (stratum.constructType === 'SUITABILITY') {
    assert.ok(stratum.confusionMatrix['CODED:Strong fit']);
    assert.equal(stratum.confusionMatrix['CODED:Positive'], undefined, 'fit never becomes positive sentiment');
  }
}
for (const item of report.cases.filter((item) => item.family === 'AWARENESS_IS_NOT_ASSESSMENT')) {
  assert.equal(item.normalized.status, 'UNCODED', 'awareness does not imply positive sentiment or strong fit');
}
assert.ok(report.cases.filter((item) => item.language === 'MIXED').some((item) => item.family === 'NEGATED_POSITIVE' && item.normalized.status === 'UNCODED'));
const sparseReport = evaluateSentimentDataset(oneCase());
assert.equal(sparseReport.strata.length, 24, 'custom datasets disclose absent language/construct cells');
assert.equal(sparseReport.strata.filter((item) => item.caseCount === 0).length, 23);
assert.equal(sparseReport.realCallCoverageGaps.length, 24, 'synthetic cases do not fill reviewed-real coverage gaps');
for (const empty of sparseReport.strata.filter((item) => item.caseCount === 0)) {
  assert.deepEqual(empty.outputStateCounts, { CODED: 0, MISSING: 0, CANT_SAY: 0, REFUSED: 0, UNCODED: 0, INVALID_CONTRACT_OUTPUT: 0 });
  assert.equal(empty.codedCoverage, null);
  assert.equal(empty.classifierAbstentionRate, null);
  assert.equal(empty.attestedReferenceAgreement, null);
  assert.deepEqual(empty.confusionMatrix, {});
}

// A provider extraction mistake remains a mismatch even if the normalizer
// correctly maps the supplied category. The excerpt is never recoded as gold.
let wrong = oneCase();
wrong.cases[0].sourceExcerpt = 'not good';
wrong.cases[0].providerOutput = 'Positive';
wrong.cases[0].evaluationType = 'RECORDED_PROVIDER_OUTPUT';
wrong.cases[0].authoredExpectation = { status: 'CODED', label: 'Negative' };
let wrongReport = evaluateSentimentDataset(wrong);
assert.equal(wrongReport.engineeringGate, 'FAIL');
assert.equal(wrongReport.mismatches[0].evaluationType, 'RECORDED_PROVIDER_OUTPUT');
assert.equal(wrongReport.mismatches[0].normalized.label, 'Positive');
assert.equal(wrongReport.mismatches[0].referenceLabel.label, 'Negative');
assert.ok(!Object.hasOwn(wrongReport.mismatches[0], 'sourceExcerpt'), 'reports omit source excerpts and provider raw output');

function signedReviewer(reference, label, overrides = {}) {
  return { reviewerReference: reference, identityKind: 'HUMAN_DECLARED', confirmedHuman: true,
    signedAt: fixedTime, evidenceReference: `offline-review-${reference}`, label,
    note: 'Declared independent review of question context, sanitized response and label definition', ...overrides };
}
function realCase() {
  const dataset = oneCase();
  dataset.cases[0] = {
    ...dataset.cases[0], id: 'REVIEW_SAMPLE_A', origin: 'SANITIZED_CALL',
    evaluationType: 'RECORDED_PROVIDER_OUTPUT', authoredExpectation: null,
    sanitization: { manuallySanitized: true, confirmedNoPersonalIdentifiers: true },
    review: { state: 'REVIEW_DECLARED_COMPLETE',
      reviewer1: signedReviewer('reviewer-a', { status: 'CODED', label: 'Positive' }),
      reviewer2: signedReviewer('reviewer-b', { status: 'CODED', label: 'Positive' }), adjudication: null }
  };
  return dataset;
}
let reviewed = realCase();
let reviewedReport = evaluateSentimentDataset(reviewed);
assert.equal(reviewedReport.reviewStatus, 'HUMAN_REVIEW_ATTESTED_UNVERIFIED');
assert.equal(reviewedReport.humanReviewGate, 'ATTESTED_REVIEW_NOT_INDEPENDENTLY_VERIFIED');
assert.equal(reviewedReport.strata[0].attestedReferenceCompared, 1);
assert.equal(reviewedReport.totals.attestedSanitizedCallCount, 1);
assert.equal(reviewedReport.realCallCoverageGaps.length, 23);
assert.equal(reviewedReport.stratifiedReviewStatus, 'HUMAN_REVIEW_PENDING', 'one attested sample cannot hide23 absent reviewed-real strata');
assert.equal(reviewedReport.strata.filter((item) => item.caseCount === 0).length, 23);
assert.equal(reviewedReport.deploymentApproval, 'NOT_GRANTED_BY_EVALUATOR');
for (const changes of [
  { identityKind: 'AUTO' }, { confirmedHuman: false }, { signedAt: null }, { evidenceReference: null },
  { reviewerReference: 'reviewer-a' }
]) {
  const pending = realCase();
  Object.assign(pending.cases[0].review.reviewer2, changes);
  const pendingReport = evaluateSentimentDataset(pending);
  assert.equal(pendingReport.cases[0].reviewStatus, 'HUMAN_REVIEW_PENDING');
  assert.equal(pendingReport.strata[0].attestedReferenceCompared, 0);
  assert.equal(pendingReport.humanReviewGate, 'INCOMPLETE_DECLARATIONS');
}
reviewed = realCase();
reviewed.cases[0].review.reviewer2.label = { status: 'CODED', label: 'Negative' };
assert.equal(evaluateSentimentDataset(reviewed).humanReviewGate, 'INCOMPLETE_DECLARATIONS', 'disagreement cannot silently choose reviewer one');
reviewed.cases[0].review.adjudication = signedReviewer('reviewer-c', { status: 'CODED', label: 'Negative' });
reviewedReport = evaluateSentimentDataset(reviewed);
assert.equal(reviewedReport.cases[0].referenceSource, 'ATTESTED_ADJUDICATION');
assert.equal(reviewedReport.engineeringGate, 'FAIL', 'recorded provider output differs from the declared adjudicated reference');
reviewed.cases[0].review.adjudication.reviewerReference = 'reviewer-a';
assert.equal(evaluateSentimentDataset(reviewed).humanReviewGate, 'INCOMPLETE_DECLARATIONS', 'adjudication needs a distinct reviewer reference');

const fakeHumanSynthetic = oneCase();
fakeHumanSynthetic.cases[0].review = realCase().cases[0].review;
assert.equal(evaluateSentimentDataset(fakeHumanSynthetic).reviewStatus, 'HUMAN_REVIEW_PENDING', 'synthetic test expectations are never promoted to real-call validation');

for (const alter of [
  (data) => { data.extra = true; },
  (data) => { data.cases[0].voterId = 'private'; },
  (data) => { data.cases[0].callId = 'private'; },
  (data) => { data.cases[0].phone = 'private'; },
  (data) => { data.cases[0].fullName = 'private'; },
  (data) => { data.cases[0].id = null; },
  (data) => { data.cases[0].id = 'a1111111-1111-4111-8111-111111111111'; },
  (data) => { data.cases[0].id = 'sample_9876543210'; },
  (data) => { data.datasetReference = 'a1111111-1111-4111-8111-111111111111'; },
  (data) => { data.cases.push(data.cases[0]); },
  (data) => { data.cases[0].outputKey = 'candidate_awareness'; },
  (data) => { data.cases[0].authoredExpectation = { status: 'CODED', label: 'Strong fit' }; },
  (data) => { data.cases[0].sourceExcerpt = 'Contact +91 98765 43210'; },
  (data) => { data.cases[0].providerOutput = 'person@example.com'; },
  (data) => { data.cases[0].providerOutput = { sentiment: 'Positive', rawSource: 'private' }; }
]) {
  const invalid = oneCase(); alter(invalid);
  assert.throws(() => validateReviewDataset(invalid), /Invalid sentiment review dataset/);
}
for (const alter of [
  (data) => { data.cases[0].sanitization.confirmedNoPersonalIdentifiers = false; },
  (data) => { data.cases[0].authoredExpectation = { status: 'CODED', label: 'Positive' }; },
  (data) => { data.cases[0].sourceExcerpt = null; },
  (data) => { data.cases[0].review.reviewer1.signedAt = '2026-02-31T00:00:00Z'; },
  (data) => { data.cases[0].review.reviewer1.reviewerReference = null; }
]) {
  const invalid = realCase(); alter(invalid);
  assert.throws(() => validateReviewDataset(invalid), /Invalid sentiment review dataset/);
}
for (const value of [true, false, 1, 5]) {
  const control = oneCase();
  control.cases[0].providerOutput = value;
  control.cases[0].authoredExpectation = { status: 'UNCODED', label: 'Uncoded response' };
  assert.equal(evaluateSentimentDataset(control).cases[0].normalized.status, 'UNCODED', 'numbers and booleans cannot invent a sentiment assessment');
}

const temporary = await mkdtemp(path.join(os.tmpdir(), 'demo-sentiment-evaluation-'));
try {
  const inputPath = path.join(temporary, 'immutable-input.json');
  const reportPath = path.join(temporary, 'new-report.json');
  const inputBytes = `${JSON.stringify(SYNTHETIC_BENCHMARK)}\n`;
  await writeFile(inputPath, inputBytes);
  let output = '';
  const streams = { out: { write: (value) => { output += value; } }, error: { write: () => {} } };
  assert.equal(await runEvaluationCli(['--input', inputPath, '--report', reportPath], streams), 0);
  assert.match(output, /HUMAN_REVIEW_PENDING/);
  assert.equal(await readFile(inputPath, 'utf8'), inputBytes, 'CLI input bytes are retained');
  assert.equal(JSON.parse(await readFile(reportPath, 'utf8')).deploymentApproval, 'NOT_GRANTED_BY_EVALUATOR');
  await assert.rejects(runEvaluationCli(['--input', inputPath, '--report', inputPath], streams), /cannot be the input/);
  await assert.rejects(runEvaluationCli(['--report', reportPath], streams), (error) => error.code === 'EEXIST');
  await assert.rejects(runEvaluationCli(['--unknown'], streams), /Unsupported/);
  await writeFile(path.join(temporary, 'mismatch.json'), JSON.stringify(wrong));
  assert.equal(await runEvaluationCli(['--input', path.join(temporary, 'mismatch.json')], streams), 1, 'provider/reference mismatch fails the engineering invocation');
  const pending = realCase(); pending.cases[0].review.state = 'REVIEW_IN_PROGRESS';
  await writeFile(path.join(temporary, 'pending.json'), JSON.stringify(pending));
  assert.equal(await runEvaluationCli(['--input', path.join(temporary, 'pending.json')], streams), 1, 'unreviewed actual samples cannot silently pass');
  const unsigned = realCase(); unsigned.cases[0].review.reviewer2.signedAt = null;
  await writeFile(path.join(temporary, 'unsigned.json'), JSON.stringify(unsigned));
  assert.equal(await runEvaluationCli(['--input', path.join(temporary, 'unsigned.json')], streams), 1, 'declared-complete actual input without two signed review declarations exits nonzero');
} finally {
  await rm(temporary, { recursive: true, force: true });
}
console.log('Demo sentiment evaluation passed: multilingual synthetic checks, construct separation, review declarations, adjudication, privacy schema, immutable inputs and recorded-output mismatches.');
