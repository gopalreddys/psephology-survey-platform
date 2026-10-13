// Synthetic local evidence only: no cloud, provider, production DB or calls.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildInterviewCompletion, buildInterviewSummary, unavailableSummary, inspectInstrument, fingerprint,
  authorize, validId, STATES, RULES_VERSION } from './interview-completion.js';

export const uid = (value) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
export const actor = { id: uid(10), role_code: 'SUPER_ADMIN' };
export function snapshot() {
  const questions = [{ question_code: 'Q_NEED', question_order: 1, question_text: 'Which public need matters?', question_type: 'OPEN_TEXT',
    required: true, metadata: { required_for_completion: true, output_variables: ['public_need'] } },
  { question_code: 'Q_KNOW', question_order: 2, question_text: 'How familiar are you?', question_type: 'SINGLE_CHOICE',
    options: [{ value: 'Familiar' }, { value: 'Not familiar' }, { value: 'Not sure' }],
    metadata: { required_for_completion: true, output_variables: ['awareness'] } },
  { question_code: 'Q_EXTRA', question_order: 3, question_text: 'Optional explanation?', question_type: 'OPEN_TEXT', required: true,
    metadata: { required_for_completion: false, output_variables: ['optional_explanation'], askIf: 'Only if respondent wants to explain' } }];
  return { id: uid(8), code: 'SYNTHETIC_PUBLIC_NEEDS', version: 1, snapshot_schema_version: 2,
    question_provenance: 'FROZEN_AT_SELECTION', questions, content_fingerprint: fingerprint(questions) };
}
export function sourceRow(overrides = {}) {
  return { execution_id: uid(6), campaign_id: uid(1), iteration_id: uid(2), run_id: uid(3), run_contact_id: uid(5), voter_id: uid(4),
    questionnaire_id: uid(8), questionnaire_snapshot: snapshot(), provider_attempt_id: 'synthetic-private-attempt', execution_status: 'COMPLETED',
    callback_received_at: '2026-10-12T10:00:00Z', execution_created_at: '2026-10-12T09:00:00Z', execution_updated_at: '2026-10-12T10:00:00Z', call_updated_at: '2026-10-12T10:01:00Z',
    call_id: uid(7), call_count: 1, identity_conflicts: 0, connectivity_status: 'connected',
    interaction_transcript: [{ role: 'user', content: 'Private synthetic transcript never exported.' }],
    response_variables: { public_need: 'Roads', awareness: 'Familiar', user_name: 'PRIVATE_NAME', phone_number: '9999999999' }, ...overrides };
}
export async function isolatedRepository() {
  const directory = await mkdtemp(path.join(tmpdir(), 'psephology-interview-completion-'));
  try {
    for (const file of ['interview-completion.js', 'interview-completion.repository.js']) {
      await writeFile(path.join(directory, file), await readFile(new URL(file, import.meta.url)));
    }
    await writeFile(path.join(directory, 'package.json'), '{"type":"module"}');
    await writeFile(path.join(directory, 'campaign-visibility.repository.js'), await readFile(new URL('../campaign-draft-privacy/campaign-visibility.repository.js', import.meta.url)));
    await writeFile(path.join(directory, 'analytics-workspace.repository.js'), "export function getCampaignStrategicAnalytics() { throw new Error('Synthetic tests must inject authorized analysis'); }");
    const repository = await import(pathToFileURL(path.join(directory, 'interview-completion.repository.js')).href);
    return { ...repository, cleanup: () => rm(directory, { recursive: true, force: true }) };
  } catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
}

async function test() {
  const build = (changes = {}) => buildInterviewCompletion(sourceRow(changes));
  let detail = build();
  assert.equal(detail.status, 'COMPLETE_RECORDED');
  assert.deepEqual(detail.coverage, { requiredQuestions: 2, accountedQuestions: 2, substantiveQuestions: 2,
    missingQuestions: 0, cantSayQuestions: 0, refusedQuestions: 0 });
  assert.equal(detail.questions[2].status, 'NOT_REQUIRED');
  assert.equal(detail.source.validation, 'AUTOMATED_COVERAGE_ONLY');
  assert.match(detail.source.evidenceFingerprint, /^[a-f0-9]{64}$/);
  for (const forbidden of ['PRIVATE_NAME', '9999999999', 'Private synthetic transcript', 'synthetic-private-attempt', 'Roads', uid(4), uid(5), uid(7)]) {
    assert.ok(!JSON.stringify(detail).includes(forbidden), forbidden);
  }
  const nullCoverage = { requiredQuestions: null, accountedQuestions: null, substantiveQuestions: null,
    missingQuestions: null, cantSayQuestions: null, refusedQuestions: null };
  const unresolved = (changes, reason) => {
    const actual = build(changes); assert.equal(actual.status, 'TECHNICALLY_UNRESOLVED');
    assert.deepEqual(actual.coverage, nullCoverage); assert.deepEqual(actual.questions, []);
    if (reason) assert.ok(actual.reasonCodes.includes(reason), actual.reasonCodes.join(','));
  };
  for (const missing of [null, '', ' ', 'NOT_ANSWERED', 'not asked', 'not-captured', 'not recorded', 'UNRECORDED', 'NO_RESPONSE', 'No answer', 'no answer.']) {
    detail = build({ response_variables: { public_need: 'Roads', awareness: missing } });
    assert.equal(detail.status, 'PARTIAL_RECORDED'); assert.equal(detail.coverage.missingQuestions, 1);
  }
  for (const value of [false, 0, 'None']) {
    detail = build({ response_variables: { public_need: value, awareness: 'Familiar' } });
    assert.equal(detail.status, 'COMPLETE_RECORDED');
  }
  for (const cant of ['CANT_SAY', "can't say", 'Not sure', 'Not enough information', 'Unknown', 'Uncertain', 'తెలియదు', 'నాకు తెలియదు', 'पता नहीं', 'मुझे पता नहीं', 'कह नहीं सकता']) {
    detail = build({ response_variables: { public_need: cant, awareness: cant } });
    assert.equal(detail.status, 'NO_SUBSTANTIVE_RECORD'); assert.equal(detail.coverage.cantSayQuestions, 2);
  }
  for (const refusal of ['REFUSED', 'Prefer not to answer', 'Prefer not to say', 'Declined to answer', 'సమాధానం ఇవ్వదలచుకోలేదు', 'చెప్పడానికి ఇష్టం లేదు', 'సమాధానం ఇవ్వను', 'जवाब नहीं देना चाहते', 'जवाब नहीं देना चाहती']) {
    detail = build({ response_variables: { public_need: refusal, awareness: refusal } });
    assert.equal(detail.status, 'NO_SUBSTANTIVE_RECORD'); assert.equal(detail.coverage.refusedQuestions, 2);
  }
  detail = build({ response_variables: { public_need: 'Roads', awareness: 'CANT_SAY' } });
  assert.equal(detail.status, 'COMPLETE_RECORDED'); assert.equal(detail.coverage.substantiveQuestions, 1); assert.equal(detail.coverage.cantSayQuestions, 1);
  assert.equal(build({ response_variables: {} }).status, 'NO_SUBSTANTIVE_RECORD');
  for (const value of [[], {}, ['Roads'], Number.NaN, Number.POSITIVE_INFINITY]) unresolved({ response_variables: { public_need: value, awareness: 'Familiar' } }, 'OUTPUT_SHAPE_UNSUPPORTED');
  unresolved({ response_variables: { public_need: 'Roads', awareness: 'familiar' } }, 'OUTPUT_OUTSIDE_VALUE_CONTRACT');
  unresolved({ response_variables: { public_need: 'Roads', awareness: true } }, 'OUTPUT_OUTSIDE_VALUE_CONTRACT');
  unresolved({ response_variables: { public_need: 'Roads', awareness: 'Familiar', Public_Need: 'Roads' } }, 'OUTPUT_KEY_CASE_CONFLICT');
  unresolved({ response_variables: { ...sourceRow().response_variables, 'public_need ': 'Jobs' } }, 'OUTPUT_KEY_CASE_CONFLICT');
  unresolved({ response_variables: { ...sourceRow().response_variables, Consent: false } }, 'OUTPUT_KEY_CASE_CONFLICT');
  unresolved({ response_variables: { ...sourceRow().response_variables, optional_explanation: {} } }, 'OUTPUT_SHAPE_UNSUPPORTED');
  const mutateInstrument = (mutate) => { const instrument = snapshot(); mutate(instrument); instrument.content_fingerprint = fingerprint(instrument.questions); return instrument; };
  for (const [change, reason] of [
    [(instrument) => { delete instrument.questions[1].metadata.required_for_completion; }, 'EXPLICIT_COMPLETION_DECLARATION_REQUIRED'],
    [(instrument) => { instrument.questions[1].metadata.required_for_completion = 'true'; }, 'EXPLICIT_COMPLETION_DECLARATION_REQUIRED'],
    [(instrument) => { instrument.questions[1].metadata.askIf = 'If familiar'; }, 'CONDITIONAL_COMPLETION_UNSUPPORTED'],
    [(instrument) => { instrument.questions[1].question_type = 'MULTIPLE_CHOICE'; }, 'QUESTION_VALUE_SEMANTICS_UNSUPPORTED'],
    [(instrument) => { instrument.questions[1].metadata.output_variables.push('awareness_reason'); }, 'MULTI_OUTPUT_CHOICE_CONTRACT_UNRESOLVED'],
    [(instrument) => { instrument.questions[1].metadata.output_variables = ['public_need']; }, 'OUTPUT_MAPPING_COLLISION'],
    [(instrument) => { instrument.questions[1].metadata.output_variables = []; }, 'REQUIRED_OUTPUT_MAPPING_REQUIRED'],
    [(instrument) => { instrument.questions[1].metadata.output_variables = ['Awareness']; }, 'OUTPUT_MAPPING_INVALID'],
    [(instrument) => { instrument.questions[0].metadata.output_variables = [{ key: 'public_need', type: 'array' }]; }, 'OUTPUT_TYPE_DECLARATION_UNSUPPORTED'],
    [(instrument) => { instrument.questions[1].output_variables = ['different_key']; }, 'OUTPUT_MAPPING_CONFLICT'],
    [(instrument) => { instrument.questions.forEach((question) => { question.metadata.required_for_completion = false; }); }, 'REQUIRED_UNCONDITIONAL_QUESTION_REQUIRED']
  ]) unresolved({ questionnaire_snapshot: mutateInstrument(change) }, reason);
  unresolved({ questionnaire_snapshot: { ...snapshot(), snapshot_schema_version: 1 } }, 'VERIFIED_FROZEN_INSTRUMENT_REQUIRED');
  unresolved({ questionnaire_snapshot: { ...snapshot(), content_fingerprint: 'a'.repeat(64) } }, 'VERIFIED_FROZEN_INSTRUMENT_REQUIRED');
  unresolved({ questionnaire_id: uid(80) }, 'VERIFIED_FROZEN_INSTRUMENT_REQUIRED');
  const numeric = mutateInstrument((instrument) => { instrument.questions[0].metadata.reporting_contract = {
    outputVariables: ['public_need'], valueType: 'NUMERIC', allowedValues: [] }; });
  assert.equal(build({ questionnaire_snapshot: numeric, response_variables: { public_need: 0, awareness: 'Familiar' } }).status, 'COMPLETE_RECORDED');
  unresolved({ questionnaire_snapshot: numeric, response_variables: { public_need: '0', awareness: 'Familiar' } }, 'OUTPUT_OUTSIDE_VALUE_CONTRACT');
  const multi = mutateInstrument((instrument) => { instrument.questions[0].metadata.output_variables.push('need_reason'); });
  assert.equal(build({ questionnaire_snapshot: multi, response_variables: { public_need: 'Roads', need_reason: 'Safety', awareness: 'Familiar' } }).status, 'COMPLETE_RECORDED');
  assert.equal(build({ questionnaire_snapshot: multi, response_variables: { public_need: 'Roads', awareness: 'Familiar' } }).status, 'PARTIAL_RECORDED');
  detail = build({ questionnaire_snapshot: multi, response_variables: { public_need: 'Roads' } });
  assert.equal(detail.status, 'PARTIAL_RECORDED'); assert.equal(detail.coverage.substantiveQuestions, 0);
  for (const value of ['CANT_SAY', 'REFUSED']) unresolved({ questionnaire_snapshot: multi, response_variables: { public_need: 'Roads', need_reason: value, awareness: 'Familiar' } }, 'MIXED_EXPLICIT_OUTPUT_STATE_UNRESOLVED');
  for (const denied of [{ consent: false }, { consent_status: 'denied' }, { consent_status: 'no_consent' }, { wrong_number: true }, { do_not_call: true }, { disposition: 'WRONG_NUMBER' }, { disposition: 'NO_CONSENT' }]) {
    detail = build({ response_variables: { ...sourceRow().response_variables, ...denied } });
    assert.equal(detail.status, 'NO_SUBSTANTIVE_RECORD'); assert.deepEqual(detail.coverage, nullCoverage);
  }
  unresolved({ response_variables: { ...sourceRow().response_variables, consent: 'possibly' } }, 'CONSENT_STATE_UNRESOLVED');
  unresolved({ response_variables: { ...sourceRow().response_variables, consent: true, disposition: 'DO_NOT_CALL' } }, 'PARTICIPATION_STATE_CONFLICT');
  unresolved({ response_variables: { ...sourceRow().response_variables, disposition: 'incomplete' } }, 'PARTIAL_DISPOSITION_CONFLICT');
  assert.equal(build({ response_variables: { public_need: 'Roads', disposition: 'partial' } }).status, 'PARTIAL_RECORDED');
  for (const changes of [{ callback_received_at: null }, { interaction_transcript: [] }, { provider_attempt_id: null }, { call_count: 2 },
    { identity_conflicts: 1 }, { source_conflict: true }, { execution_status: 'CANCELLED' }, { execution_status: 'FAILED' }, { connectivity_status: 'maybe' }]) unresolved(changes);
  assert.equal(build({ execution_status: 'SUBMITTED', callback_received_at: null, call_id: null, call_count: 0 }).status, 'IN_PROGRESS');
  unresolved({ execution_status: 'SUBMITTED', identity_conflicts: 1 });
  unresolved({ execution_chronology_unresolved: true }, 'EXECUTION_CHRONOLOGY_UNRESOLVED');
  unresolved({ execution_id: null, missing_execution_evidence: true }, 'RETAINED_ATTEMPT_WITHOUT_EXECUTION');
  assert.equal(build({ execution_id: null, call_id: null }).status, 'NOT_ATTEMPTED');
  assert.equal(build({ connectivity_status: 'busy', execution_status: 'FAILED', interaction_transcript: [], response_variables: {} }).status, 'NOT_CONNECTED');
  unresolved({ connectivity_status: 'busy', execution_status: 'FAILED' }, 'NON_CONNECTION_EVIDENCE_CONFLICT');
  unresolved({ connectivity_status: 'busy', execution_status: 'FAILED', interaction_transcript: [], response_variables: { awareness: 'CANT_SAY' } }, 'NON_CONNECTION_EVIDENCE_CONFLICT');
  unresolved({ connectivity_status: 'busy', execution_status: 'FAILED', interaction_transcript: [], response_variables: { awareness: 'REFUSED' } }, 'NON_CONNECTION_EVIDENCE_CONFLICT');
  assert.notEqual(build({ response_variables: { public_need: 'Jobs', awareness: 'Familiar' } }).source.evidenceFingerprint, build().source.evidenceFingerprint);
  assert.notEqual(build({ connectivity_status: 'CONNECTED' }).source.evidenceFingerprint, build().source.evidenceFingerprint);
  assert.notEqual(build({ execution_created_at: '2026-10-12T08:00:00Z' }).source.evidenceFingerprint, build().source.evidenceFingerprint);
  assert.equal(inspectInstrument(sourceRow()).hash, snapshot().content_fingerprint);
  const stateRows = [sourceRow(), sourceRow({ response_variables: { public_need: 'Roads' } }), sourceRow({ response_variables: { public_need: 'CANT_SAY', awareness: 'REFUSED' } }),
    sourceRow({ callback_received_at: null }), sourceRow({ connectivity_status: 'busy', execution_status: 'FAILED', interaction_transcript: [], response_variables: {} }), sourceRow({ execution_status: 'SUBMITTED' }), sourceRow({ execution_id: null })];
  assert.deepEqual(stateRows.map((row) => buildInterviewCompletion(row).status), STATES);
  let summary = buildInterviewSummary(uid(1), uid(2), stateRows, sourceRow());
  assert.equal(summary.status, 'WITHHELD'); assert.ok(Object.values(summary.counts).every((value) => value === null));
  summary = buildInterviewSummary(uid(1), uid(2), stateRows.flatMap((row) => Array.from({ length: 5 }, () => row)), sourceRow());
  assert.equal(summary.status, 'AVAILABLE'); assert.equal(summary.counts.selectedBase, 35);
  assert.deepEqual(Object.values(summary.counts).slice(1), Array(7).fill(5));
  assert.equal(summary.rulesVersion, RULES_VERSION);
  for (const privateValue of [uid(6), uid(4), 'Q_NEED', 'PRIVATE_NAME', 'Roads', 'synthetic-private-attempt']) assert.ok(!JSON.stringify(summary).includes(privateValue));
  summary = buildInterviewSummary(uid(1), uid(2), [], sourceRow());
  assert.equal(summary.status, 'AVAILABLE'); assert.ok(Object.values(summary.counts).every((value) => value === 0));
  assert.ok(Object.values(unavailableSummary(uid(1), uid(2)).counts).every((value) => value === null));
  assert.throws(() => authorize({ id: uid(10), role_code: 'CAMPAIGNER' }), { statusCode: 403 });
  assert.throws(() => validId('wrong'), { statusCode: 400 });
  // Exact reserved-state parity with the shared taxonomy, without importing its
  // political/sentiment normalizer or using fuzzy language matching at runtime.
  const sharedRules = JSON.parse(await readFile(new URL('../output-variable-standardization/normalization-rules.json', import.meta.url), 'utf8'));
  const parity = {
    missingPattern: ['null', 'undefined', 'n/a', 'na', 'not asked', 'not captured', 'not recorded', 'no response', 'no answer', 'missing'],
    cantSayPattern: ["can't say", 'cannot say', 'cant say', "don't know", 'do not know', 'dont know', 'not sure', 'unsure', 'unknown', 'uncertain', 'no idea', 'no opinion', 'not enough information', 'తెలియదు', 'చెప్పలేను', 'నాకు తెలియదు', 'पता नहीं', 'मुझे पता नहीं', 'कह नहीं सकता'],
    refusedPattern: ['prefer not to answer', 'prefer not to say', 'declined', 'refused', 'declined to answer', 'చెప్పడానికి ఇష్టం లేదు', 'సమాధానం ఇవ్వను', 'जवाब नहीं देना चाहता', 'जवाब नहीं देना चाहती']
  };
  for (const [pattern, values] of Object.entries(parity)) for (const value of values) {
    assert.ok(new RegExp(sharedRules[pattern], 'i').test(value));
    for (const recorded of [value, `${value}.`, value.replaceAll("'", '‘'), value.replaceAll("'", '’')]) {
      const classified = build({ response_variables: { public_need: recorded, awareness: recorded } });
      assert.equal(classified.status, 'NO_SUBSTANTIVE_RECORD');
      assert.equal(classified.coverage[pattern === 'missingPattern' ? 'missingQuestions' : pattern === 'cantSayPattern' ? 'cantSayQuestions' : 'refusedQuestions'], 2);
    }
  }
  // Exercise the real deployed MLC import shape after freezing, not a catalogue
  // lookup at assessment time. Optional text askIf rules remain optional.
  const mlc = JSON.parse(await readFile(new URL('../campaign-mlc-questionnaire/campaign-mlc-pulse-v1.json', import.meta.url), 'utf8'));
  const frozenMlc = { id: mlc.platformQuestionnaireId, code: mlc.questionnaireCode, version: mlc.versionNumber,
    snapshot_schema_version: 2, question_provenance: 'FROZEN_AT_SELECTION', questions: mlc.questions.map((question) => ({
      question_code: question.questionCode, question_order: question.questionOrder, question_text: question.questionText,
      question_type: question.questionType, options: question.options, required: question.required, metadata: {
        required_for_completion: question.requiredForCompletion, output_variables: question.outputVariables,
        ...(question.askIf ? { askIf: question.askIf } : {}) } })) };
  frozenMlc.content_fingerprint = fingerprint(frozenMlc.questions);
  detail = build({ questionnaire_id: frozenMlc.id, questionnaire_snapshot: frozenMlc, response_variables: {
    graduate_issue_priority: 'Jobs', issue_sentiment: 'Concerned', mlc_role_awareness: 'Not familiar', incumbent_awareness: 'No',
    candidate_criterion: 'Responsiveness', party_salience_unaided: 'None', party_salience_reason: 'No visible activity',
    perceived_issue_leader_aided: 'None', veeresh_awareness: 'Not heard of him', veeresh_impression: 'No prior knowledge' } });
  assert.equal(detail.status, 'COMPLETE_RECORDED'); assert.equal(detail.coverage.requiredQuestions, 7);
  assert.equal(detail.questions.filter((question) => question.status === 'NOT_REQUIRED').length, 3);
  assert.ok(!JSON.stringify(detail).includes('No visible activity'));
  const routes = await readFile(new URL('./interview-completion.routes.js', import.meta.url), 'utf8');
  assert.ok(!/router\.(post|put|patch|delete)/.test(routes)); assert.match(routes, /no-store/);
  console.log('Interview completion frozen contracts, scalar/missing states, seven outcomes, exact sources, denied participation and private partition tests passed.');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await test();
