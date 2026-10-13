import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CHECK_KEYS, authorize, canonical, fingerprint, evaluateEvidence, buildReviewDetail, buildReviewSummary,
  validateReview, validateDecision, normalizationRulesHash } from './call-quality-review.js';

export const uid = (number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
export const checks = Object.fromEntries(CHECK_KEYS.map((key) => [key, 'PASS']));
export const ruleHash = 'a'.repeat(64);
export const actor = { id: uid(11), role_code: 'ADMIN' };
export const second = { id: uid(12), role_code: 'ADMIN' };
export const approver = { id: uid(13), role_code: 'SUPER_ADMIN' };
export const questions = [{ question_code: 'Q_SERVICE', question_order: 1, question_text: 'Which public service needs improvement?',
  metadata: { output_variables: ['issue_priority'] } }];
export const snapshot = { id: uid(8), code: 'PUBLIC_SERVICE_V2', version: 2, snapshot_schema_version: 2,
  question_provenance: 'FROZEN_AT_SELECTION', questions, content_fingerprint: fingerprint(questions) };
export const sourceRow = { execution_id: uid(6), run_contact_id: uid(5), run_id: uid(3), voter_id: uid(4),
  provider_attempt_id: 'TEST_ATTEMPT', execution_status: 'COMPLETED', callback_received_at: '2026-10-12T10:00:00Z',
  campaign_id: uid(1), iteration_id: uid(2), questionnaire_id: uid(8), questionnaire_snapshot: snapshot,
  request_payload: { providerDeployment: { app_id: 'TEST_APP', app_version: 5, connection_id: 'TEST_CONNECTION' },
    runtime: { full_name: 'PRIVATE_SOURCE_NAME', phone_number: '9000000000' } },
  call_id: uid(7), call_count: 1, identity_conflicts: 0, connectivity_status: 'connected',
  interaction_transcript: [{ speaker: 'agent', text: 'Which public service needs improvement?' }, { role: 'user', content: 'Public transport.' }],
  response_variables: { issue_priority: 'Public transport', voter_name: 'PRIVATE_SOURCE_NAME', phone_number: '9000000000' } };
export const evidenceHash = evaluateEvidence(sourceRow, ruleHash).evidenceFingerprint;
export const reviewBody = { expectedEvidenceFingerprint: evidenceHash, language: 'ENGLISH', checks, issueBuckets: [], note: 'Question delivery and recorded answer checked.', attested: true };
export const decisionBody = { expectedEvidenceFingerprint: evidenceHash, expectedDecisionRevision: 0, action: 'APPROVE_SAMPLE',
  reason: 'Two independent checks and exact call evidence inspected.', attested: true };
export const reviewRow = (id, account, extra = {}) => ({ id: uid(id), execution_id: uid(6), actor_user_id: account.id,
  evidence_fingerprint: evidenceHash, language: 'ENGLISH', checks, issue_buckets: [], note: 'Sanitized diagnostic note.',
  created_at: '2026-10-12T11:00:00Z', eligible: true, ...extra });
export async function isolatedRepository() {
  let code = await readFile(new URL('./call-quality-review.repository.js', import.meta.url), 'utf8');
  code = code.replace("'./call-quality-review.js'", JSON.stringify(new URL('./call-quality-review.js', import.meta.url).href))
    .replace("'./campaign-visibility.repository.js'", JSON.stringify(new URL('../campaign-draft-privacy/campaign-visibility.repository.js', import.meta.url).href))
    .replace(/import \{ resolveResearchScope \} from '[^']+';/, "const resolveResearchScope = () => { throw new Error('Tests must inject an authorized scope'); };");
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}

if (process.argv[1]?.endsWith('test-call-quality-review.mjs')) {
  assert.deepEqual(canonical({ z: 1, a: { d: 2, b: 3 } }), { a: { b: 3, d: 2 }, z: 1 });
  assert.deepEqual(validateReview(reviewBody), reviewBody);
  assert.deepEqual(validateDecision(decisionBody), decisionBody);
  for (const change of [
    { attested: false }, { expectedEvidenceFingerprint: 'broken' }, { note: 'Phone 9999999999' }, { note: 'person@example.com' },
    { note: 'https://provider.example/private' }, { note: uid(99) }, { note: 'ID ABC1234567' }, { note: 'bad\u007f' }, { actorId: uid(90) },
    { language: 'FROM_VOTER_NAME' }, { checks: { ...checks, inferredPoliticalLean: 'PASS' } }, { checks: { ...checks, neutrality: null } },
    { issueBuckets: ['UNKNOWN'] }, { issueBuckets: ['OTHER', 'OTHER'] }, { note: 'x'.repeat(1001) }
  ]) assert.throws(() => validateReview({ ...reviewBody, ...change }), (error) => error.statusCode === 400);
  for (const change of [{ reason: '' }, { attested: false }, { expectedDecisionRevision: -1 }, { action: 'APPROVE_RESEARCH' }, { decidedAt: '2026-01-01' }]) {
    assert.throws(() => validateDecision({ ...decisionBody, ...change }), (error) => error.statusCode === 400);
  }
  for (const denied of [null, { ...actor, id: 'not-an-id' }, { ...actor, role_code: 'CAMPAIGN_MANAGER' }, { ...actor, role_code: 'CAMPAIGNER' }]) assert.throws(() => authorize(denied), { statusCode: 403 });
  assert.equal(normalizationRulesHash(), null, 'Undeployed local folder cannot invent a live rules hash');
  const evidence = evaluateEvidence(sourceRow, ruleHash);
  assert.equal(evidence.reviewable, true); assert.equal(evidence.sourceReady, true);
  assert.deepEqual(evidence.evidence.outputs, { issue_priority: 'Public transport' });
  assert.ok(!JSON.stringify(evidence.evidence).includes('PRIVATE_SOURCE_NAME'));
  assert.ok(!JSON.stringify(evidence.evidence).includes('9000000000'));
  const sarvamTranscript = [
    { role: 'agent', en_text: 'Which service should improve?', indic_text: 'ఏ సేవ మెరుగుపడాలి?' },
    { role: 'user', en_text: 'Public transport.', indic_text: 'ప్రజా రవాణా.' },
    { role: 'user', en_text: 'Transport access.', indic_text: ' ' }
  ];
  const sarvam = evaluateEvidence({ ...sourceRow, interaction_transcript: sarvamTranscript }, ruleHash);
  assert.equal(sarvam.reviewable, true); assert.equal(sarvam.sourceReady, true);
  assert.deepEqual(sarvam.evidence.transcript, [
    { speaker: 'agent', text: 'ఏ సేవ మెరుగుపడాలి?' },
    { speaker: 'user', text: 'ప్రజా రవాణా.' },
    { speaker: 'user', text: 'Transport access.' }
  ], 'Native text is preferred; a translated copy does not become another turn');
  assert.equal(sarvam.evidence.transcript.length, sarvamTranscript.length);
  assert.notEqual(evaluateEvidence({ ...sourceRow, interaction_transcript: sarvamTranscript.map((turn, index) =>
    index === 0 ? { ...turn, en_text: 'Changed retained translation.' } : turn) }, ruleHash).evidenceFingerprint,
  sarvam.evidenceFingerprint, 'The unused bilingual representation still binds the raw evidence fingerprint');
  assert.deepEqual(evaluateEvidence({ ...sourceRow, interaction_transcript: [
    { role: 'user', content: '', text: 'Legacy text fallback.' },
    { role: 'user', content: ' ', text: '', message: [], indic_text: 'సేవలు మెరుగుపడాలి.', en_text: 'Services should improve.' },
    { role: 'user', content: { metadata: 'NOT_TRANSCRIPT' }, indic_text: '', en_text: 'Supported provider fallback.' },
    { role: 'user', content: [{ text: ' ' }, { text: 0 }], text: ['Legacy blocks.', { text: 'Retained text.' }] }
  ] }, ruleHash).evidence.transcript, [
    { speaker: 'user', text: 'Legacy text fallback.' },
    { speaker: 'user', text: 'సేవలు మెరుగుపడాలి.' },
    { speaker: 'user', text: 'Supported provider fallback.' },
    { speaker: 'user', text: 'Legacy blocks. Retained text.' }
  ], 'Empty or unsupported primary fields must not suppress a supported nonblank alias');
  for (const unsupported of [
    [{ role: 'user', en_text: '', indic_text: ' ' }],
    [{ role: 'user', en_text: { text: 'Nested unsupported' }, indic_text: 42 }],
    [{ role: 'user', en_text: ['Unsupported provider array'], indic_text: false }],
    [{ role: 'user', content: [{ text: 42 }], metadata: 'Not transcript content' }]
  ]) {
    const result = evaluateEvidence({ ...sourceRow, interaction_transcript: unsupported }, ruleHash);
    assert.equal(result.reviewable, false); assert.equal(result.evidenceFingerprint, null);
    assert.deepEqual(result.evidence.transcript, []);
  }
  for (const altered of [
    { response_variables: { ...sourceRow.response_variables, phone_number: '9000000001' } },
    { interaction_transcript: [{ role: 'user', content: 'Different retained answer' }] },
    { request_payload: { providerDeployment: { app_id: 'TEST_APP', app_version: 6 } } },
    { questionnaire_snapshot: { ...snapshot, questions: [{ ...questions[0], question_text: 'Different text' }] } }
  ]) assert.notEqual(evaluateEvidence({ ...sourceRow, ...altered }, ruleHash).evidenceFingerprint, evidenceHash);
  assert.notEqual(evaluateEvidence(sourceRow, 'b'.repeat(64)).evidenceFingerprint, evidenceHash);
  for (const altered of [{ call_count: 2 }, { identity_conflicts: 1 }, { provider_attempt_id: ' ' }, { callback_received_at: null }, { interaction_transcript: [] }, { execution_status: 'SUBMITTED' }, { connectivity_status: 'busy' }]) {
    const result = evaluateEvidence({ ...sourceRow, ...altered }, ruleHash); assert.equal(result.reviewable, false); assert.equal(result.evidenceFingerprint, null);
  }
  assert.equal(evaluateEvidence({ ...sourceRow, request_payload: {}, voice_agent_snapshot: { app_id: 'UNSAFE_FALLBACK', app_version: 5 } }, ruleHash).evidence.agent.basis, 'NOT_RECORDED');
  assert.equal(evaluateEvidence({ ...sourceRow, questionnaire_snapshot: { ...snapshot, snapshot_schema_version: 1 } }, ruleHash).sourceReady, false);
  const nested = evaluateEvidence({ ...sourceRow, response_variables: { issue_priority: { phone: 'PRIVATE_NESTED' } } }, ruleHash);
  assert.equal(nested.sourceReady, false); assert.ok(!JSON.stringify(nested.evidence).includes('PRIVATE_NESTED'));
  assert.equal(evaluateEvidence(sourceRow, null).sourceReady, false);
  const unmappedQuestions = [{ ...questions[0], metadata: {} }];
  const unmapped = evaluateEvidence({ ...sourceRow, questionnaire_snapshot: { ...snapshot, questions: unmappedQuestions, content_fingerprint: fingerprint(unmappedQuestions) } }, ruleHash);
  assert.equal(unmapped.sourceReady, false); assert.ok(unmapped.blockedReasons.includes('FROZEN_OUTPUT_MAPPING_REQUIRED'));
  assert.equal(evaluateEvidence({ ...sourceRow, response_variables: {} }, ruleHash).sourceReady, false);
  const failReview = reviewRow(21, actor, { checks: { ...checks, greetingFlow: 'FAIL' }, issue_buckets: ['GREETING_LOOP'] });
  let detail = buildReviewDetail(sourceRow, second, [failReview], [], ruleHash);
  assert.equal(detail.permissions.canReview, true); assert.equal(detail.approvalReady, false); assert.deepEqual(detail.reviews, []);
  assert.ok(!detail.blockedReasons.includes('ALL_CHECKS_MUST_PASS_WITHOUT_ISSUES'), 'First assessment is sealed from the next independent reviewer');
  assert.equal(detail.permissions.canDecide, false, 'A premature decision would unblind later reviewers');
  const staleDecision = { execution_id: uid(6), revision: 1, action: 'REJECT_SAMPLE', actor_user_id: approver.id,
    evidence_fingerprint: 'b'.repeat(64), reason: 'Prior evaluation must not prime independent reviewers.', decided_at: '2026-10-12T12:00:00Z' };
  detail = buildReviewDetail(sourceRow, second, [], [staleDecision], ruleHash);
  assert.equal(detail.permissions.canReview, true); assert.equal(detail.decision, null); assert.equal(detail.decisionRevision, 1);
  const passed = [reviewRow(21, actor), reviewRow(22, second)];
  detail = buildReviewDetail(sourceRow, actor, passed, [], ruleHash);
  assert.equal(detail.reviews.length, 1); assert.equal(detail.permissions.canDecide, false);
  const alphaActor = { ...actor, id: uid(11).replace(/.$/, 'a') };
  detail = buildReviewDetail(sourceRow, { ...alphaActor, id: alphaActor.id.toUpperCase() }, [reviewRow(41, alphaActor), passed[1]], [], ruleHash);
  assert.equal(detail.permissions.canDecide, false, 'UUID case cannot bypass reviewer/approver separation');
  detail = buildReviewDetail(sourceRow, approver, passed, [], ruleHash);
  assert.equal(detail.approvalReady, true); assert.equal(detail.permissions.canDecide, true); assert.equal(detail.permissions.canReview, false); assert.deepEqual(detail.reviews, []);
  detail = buildReviewDetail(sourceRow, approver, [passed[0], { ...passed[1], eligible: false }], [], ruleHash);
  assert.equal(detail.approvalReady, false); assert.equal(detail.permissions.canReview, false, 'Removed reviewer never reopens an unblinded slot'); assert.equal(detail.counts.staleReviews, 1);
  const approved = { execution_id: uid(6), revision: 1, action: 'APPROVE_SAMPLE', reason: 'Sanitized sign-off for this sample only.',
    actor_user_id: approver.id, evidence_fingerprint: evidenceHash, decided_at: '2026-10-12T12:00:00Z', eligible: true };
  let summary = buildReviewSummary(uid(1), uid(2), [sourceRow], passed, [approved], ruleHash);
  assert.equal(summary.status, 'SAMPLE_APPROVED_PARTIAL'); assert.equal(summary.counts.approvedCalls, 1);
  assert.ok(!JSON.stringify(summary).includes(evidenceHash)); assert.ok(!JSON.stringify(summary).includes('Sanitized diagnostic note'));
  assert.equal(buildReviewSummary(uid(1), uid(2), [sourceRow], passed, [approved], 'b'.repeat(64)).status, 'STALE');
  assert.equal(buildReviewSummary(uid(1), uid(2), [sourceRow], passed, [{ ...approved, eligible: false }], ruleHash).status, 'STALE');
  assert.equal(buildReviewSummary(uid(1), uid(2), [sourceRow], passed, [{ ...approved, action: 'REJECT_SAMPLE' }], ruleHash).status, 'CHANGES_REQUIRED');
  assert.equal(buildReviewSummary(uid(1), uid(2), [sourceRow], [failReview, passed[1]], [approved], ruleHash).status, 'STALE');
  assert.equal(buildReviewSummary(uid(1), uid(2), [], passed, [approved], ruleHash).counts.staleCalls, 1);
  const repository = await isolatedRepository();
  let calls = 0;
  const forbiddenDb = { connect() { calls++; throw new Error('Forbidden access reached database'); } };
  await assert.rejects(repository.getCallQualityExecution(forbiddenDb, { ...actor, role_code: 'CAMPAIGN_MANAGER' }, uid(6)), { statusCode: 403 });
  await assert.rejects(repository.saveCallQualityReview(forbiddenDb, actor, uid(6), { ...reviewBody, actor: approver }), { statusCode: 400 });
  assert.equal(calls, 0);
  let authorized = false;
  await assert.rejects(repository.getCampaignCallQuality(forbiddenDb, actor, uid(1), {}, { analyze: async () => { authorized = true; throw Object.assign(new Error('Denied'), { statusCode: 404 }); } }), { statusCode: 404 });
  assert.equal(authorized, true); assert.equal(calls, 0);
  await assert.rejects(repository.getCampaignCallQuality(forbiddenDb, actor, uid(1), { runId: uid(3) }), { statusCode: 400 });
  // A simple isolated serialization mock: simultaneous independent reviews are
  // queued by the server's target lock; only first two slots can be appended.
  const state = { reviews: [], decisions: [], actorIds: new Set([actor.id, second.id, approver.id]), statements: [] };
  let queue = Promise.resolve();
  const mock = { async connect() {
    let unlock = null;
    return { async query(sql, values = []) {
      state.statements.push(sql);
      if (/^BEGIN/.test(sql)) {
        const prior = queue; queue = new Promise((resolve) => { unlock = resolve; }); await prior;
      } else if (/^(COMMIT|ROLLBACK)/.test(sql)) { unlock?.(); unlock = null; }
      else if (sql.includes('FROM users account JOIN roles role')) return { rows: state.actorIds.has(values[0]) || sql.includes('account.id IN') ? [{ id: values[0] }] : [] };
      else if (sql.includes('SELECT execution.id AS execution_id, iteration.id AS iteration_id')) return { rows: [{ execution_id: uid(6), iteration_id: uid(2), campaign_id: uid(1) }] };
      else if (sql.includes('FROM calls matched JOIN call_executions')) return { rows: [{ id: uid(7) }] };
      else if (sql.includes('execution.request_payload')) return { rows: [structuredClone(sourceRow)] };
      else if (sql.includes('FROM call_quality_reviews audit')) return { rows: structuredClone(state.reviews) };
      else if (sql.includes('FROM call_quality_decisions audit')) return { rows: structuredClone(state.decisions) };
      else if (sql.includes('INSERT INTO call_quality_reviews')) {
        state.reviews.push(reviewRow(30 + state.reviews.length, { id: values[4] }, { evidence_fingerprint: values[5], language: values[6], checks: JSON.parse(values[7]), issue_buckets: values[8], note: values[9] }));
      } else if (sql.includes('INSERT INTO call_quality_decisions')) {
        state.decisions.push({ ...approved, actor_user_id: values[4], evidence_fingerprint: values[5], revision: values[6], action: values[7], reason: values[8] });
      } else throw new Error(`Unexpected isolated query: ${sql.slice(0, 90)}`);
      return { rows: [], rowCount: 0 };
    }, release() { unlock?.(); } };
  } };
  const deps = { normalizationRulesHash: () => ruleHash };
  const concurrent = await Promise.allSettled([actor, second, approver].map((account) => repository.saveCallQualityReview(mock, account, uid(6), reviewBody, deps)));
  assert.equal(concurrent.filter((result) => result.status === 'fulfilled').length, 2);
  assert.equal(state.reviews.length, 2);
  assert.equal(concurrent[2].reason.statusCode, 409);
  await assert.rejects(repository.saveCallQualityDecision(mock, actor, uid(6), decisionBody, deps), { code: 'CALL_QUALITY_APPROVER_CONFLICT' });
  await repository.saveCallQualityDecision(mock, approver, uid(6), decisionBody, deps);
  await assert.rejects(repository.saveCallQualityDecision(mock, approver, uid(6), decisionBody, deps), { code: 'CALL_QUALITY_DECISION_CONFLICT' });
  await assert.rejects(repository.saveCallQualityReview(mock, actor, uid(6), { ...reviewBody, expectedEvidenceFingerprint: 'b'.repeat(64) }, deps), { code: 'CALL_QUALITY_EVIDENCE_CONFLICT' });
  assert.ok(state.statements.some((sql) => sql.includes('FOR UPDATE OF iteration, execution, campaign, link, contact, run')));
  assert.ok(state.statements.some((sql) => sql.includes('ORDER BY account.id FOR SHARE OF account, role')));
  const routeSource = await readFile(new URL('./call-quality-review.routes.js', import.meta.url), 'utf8');
  assert.ok(!routeSource.includes('router.use(')); assert.equal((routeSource.match(/requireAuth, requireRole\(/g) || []).length, 4);
  assert.ok(!routeSource.includes('error.message ||')); assert.ok(routeSource.includes("res.set('Cache-Control', 'no-store')"));
  console.log('Call-quality validation, source binding, blind assessments, independent approval, permissions and serialized concurrency tests passed.');
}
