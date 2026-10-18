import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { hashQuestionnaireFixture, validateQuestionnaireFixture, importQuestionnaireVersion, parseArguments, runCli } from './import-campaign-questionnaire-version.mjs';

const fixture = JSON.parse(await readFile(new URL('./campaign-mlc-pulse-v2.json', import.meta.url), 'utf8'));
const prepared = validateQuestionnaireFixture(fixture), actorId = '8d683272-64e7-4df6-861b-4199f4bfb0d1';
const questionnaireId = '00000000-0000-4000-8000-000000000021';
const applyOptions = { apply: true, expectedFixtureHash: prepared.fixtureHash, createdBy: actorId };
assert.equal(prepared.questions.length, 10); assert.equal(prepared.reportingContracts, 9); assert.equal(prepared.requiredQuestions, 6);
assert.equal(hashQuestionnaireFixture(Object.fromEntries(Object.entries(fixture).reverse())), prepared.fixtureHash, 'Object key order is not semantic');
for (const change of [
  (value) => { value.versionNumber = 1; },
  (value) => { value.sourceBoundary = 'REWRITE'; },
  (value) => { value.configurationStatus = 'APPROVED'; },
  (value) => { value.questions.pop(); },
  (value) => { value.questions[1].questionOrder = 1; },
  (value) => { value.questions[1].questionCode = value.questions[0].questionCode.toLowerCase(); },
  (value) => { value.questions[1].outputVariables = value.questions[0].outputVariables; },
  (value) => { value.questions[0].questionTextTelugu = ''; },
  (value) => { value.questions[0].requiredForCompletion = undefined; },
  (value) => { value.questions[0].askIf = 'Conditional required question'; },
  (value) => { value.questions[0].reportingContract.outputVariables = ['wrong_key']; },
  (value) => { value.questions[0].reportingContract.target = { type: 'CANDIDATE', id: 'unrelated', name: 'Unrelated' }; },
  (value) => { value.questions[0].reportingContract.allowedValues.push('refused'); },
  (value) => { value.questions[4].options = []; },
  (value) => { value.questions[4].options[0].value = 'Unrecognized'; },
  (value) => { value.questions[4].options[0].unknown = true; },
  (value) => { value.questions[6].reportingStatus = 'MADE_UP'; },
  (value) => { value.contextOnlyQuestionCodes = []; },
  (value) => { value.reportingContractCount = 10; },
  (value) => { value.questions[9].reportingContract.target.type = 'NONE'; }
]) { const value = structuredClone(fixture); change(value); assert.throws(() => validateQuestionnaireFixture(value)); }

const columnTypes = {
  questionnaires: { id: 'uuid', questionnaire_code: 'varchar', questionnaire_name: 'varchar', description: 'text', version_number: 'int4', primary_language: 'varchar', status: 'varchar', created_by: 'uuid' },
  questions: { id: 'uuid', questionnaire_id: 'uuid', question_order: 'int4', question_code: 'varchar', question_text: 'text', question_type: 'varchar', options: 'jsonb', required: 'bool', analysis_category: 'varchar', metadata: 'jsonb' }
};
const columns = Object.entries(columnTypes).flatMap(([table_name, entries]) => Object.entries(entries).map(([column_name, data_type]) =>
  ({ table_name, column_name, data_type, not_null: true, default_expression: column_name === 'id' ? 'gen_random_uuid()' : null, generated: '', identity: '' })));
function harness(overrides = {}) {
  const state = { headers: [], questions: [], used: 0, columns: structuredClone(columns), unique: true, queries: [], writes: 0, questionWrites: 0,
    released: 0, connections: 0, rolledBack: false, ...overrides };
  let before;
  const db = { async connect() { state.connections++; return {
    async query(sql, values = []) {
      state.queries.push({ sql, values });
      assert.doesNotMatch(sql, /\b(?:UPDATE|DELETE|TRUNCATE|ALTER|DROP)\b(?!\s*$)/i, 'No existing data is rewritten');
      if (/^BEGIN/.test(sql)) { before = { headers: structuredClone(state.headers), questions: structuredClone(state.questions) }; return { rows: [] }; }
      if (sql === 'ROLLBACK') { state.headers = before.headers; state.questions = before.questions; state.rolledBack = true; return { rows: [] }; }
      if (sql === 'COMMIT') { if (state.failCommit) throw new Error('Injected commit failure'); return { rows: [] }; }
      if (/^SET LOCAL/.test(sql) || sql.includes('pg_advisory_xact_lock')) return { rows: [] };
      if (sql.includes('FROM public.users')) return { rows: state.denyActor ? [] : [{ id: values[0].toLowerCase(), role_code: state.actorRole || 'SUPER_ADMIN' }] };
      if (sql.includes('attribute.attname AS column_name')) return { rows: state.columns };
      if (sql.includes('AS identity_enforced')) return { rows: [{ identity_enforced: state.unique }] };
      if (sql.includes('SELECT * FROM public.questionnaires')) return { rows: structuredClone(state.headers.filter((header) => header.questionnaire_code === values[0])) };
      if (sql.includes('FROM public.program_iterations')) return { rows: [{ used_by_iterations: state.used }] };
      if (sql.includes('SELECT to_jsonb(question)')) return { rows: structuredClone(state.questions.filter((question) => question.questionnaire_id === values[0])
        .sort((left, right) => left.question_order - right.question_order).map((question) => ({ question }))) };
      if (sql.includes('INSERT INTO public.questionnaires')) {
        state.writes++; const header = { id: questionnaireId, questionnaire_code: values[0], questionnaire_name: values[1], description: values[2],
          version_number: values[3], primary_language: values[4], status: 'DRAFT', created_by: values[5] };
        state.headers.push(header); return { rows: [structuredClone(header)] };
      }
      if (sql.includes('INSERT INTO public.questions')) {
        state.writes++; state.questionWrites++;
        if (state.failQuestion === state.questionWrites) throw new Error('Injected question insert failure');
        const id = `00000000-0000-4000-8000-${String(state.questionWrites + 100).padStart(12, '0')}`;
        state.questions.push({ id, questionnaire_id: values[0], question_order: values[1], question_code: values[2], question_text: values[3],
          question_type: values[4], options: JSON.parse(values[5]), required: values[6], analysis_category: values[7], metadata: JSON.parse(values[8]) });
        return { rows: [{ id }] };
      }
      throw new Error(`Unexpected SQL ${sql}`);
    }, release() { state.released++; }
  }; } };
  return { db, state };
}

const dry = harness();
const dryResult = await importQuestionnaireVersion(dry.db, fixture);
assert.equal(dryResult.mode, 'DRY_RUN'); assert.equal(dryResult.changed, false); assert.equal(dryResult.questionnaireId, null);
assert.equal(dry.state.writes, 0); assert.equal(dry.state.questions.length, 0); assert.equal(dry.state.released, 1);
assert.match(dry.state.queries[0].sql, /READ ONLY/); assert.ok(!dry.state.queries.some(({ sql }) => sql.includes('pg_advisory_xact_lock')));

const created = harness();
const result = await importQuestionnaireVersion(created.db, fixture, applyOptions);
assert.equal(result.mode, 'CREATED'); assert.equal(result.changed, true); assert.equal(result.questionnaireId, questionnaireId);
assert.equal(created.state.writes, 11); assert.equal(created.state.headers.length, 1); assert.equal(created.state.questions.length, 10);
assert.equal(created.state.headers[0].created_by, actorId);
assert.deepEqual(created.state.questions.map((question) => question.metadata.question_text_telugu), fixture.questions.map((question) => question.questionTextTelugu));
assert.ok(created.state.questions.every((question) => question.metadata.questionnaire_import.fixtureHash === prepared.fixtureHash));
assert.deepEqual(created.state.questions[7].metadata.reporting_contract.target, fixture.questions[7].reportingContract.target);
assert.equal(created.state.questions[6].metadata.reporting_contract, undefined, 'Context-only awareness is not assigned a made-up report');
assert.equal(created.state.questions[7].metadata.askIf, fixture.questions[7].askIf);
assert.ok(created.state.queries.findIndex(({ sql }) => sql.includes('pg_advisory_xact_lock')) < created.state.queries.findIndex(({ sql }) => sql.includes('INSERT INTO')));
for (const flag of ['existingQuestionnairesChanged', 'iterationsAssigned', 'providerUpdated', 'agentCommitted', 'callsLaunched', 'launchApproved']) assert.equal(result[flag], false);
const again = await importQuestionnaireVersion(created.db, fixture, applyOptions);
assert.equal(again.mode, 'ALREADY_PRESENT'); assert.equal(again.changed, false); assert.equal(created.state.writes, 11);
const existingDry = await importQuestionnaireVersion(created.db, fixture);
assert.equal(existingDry.action, 'EXACT_UNUSED_DRAFT_ALREADY_PRESENT'); assert.equal(existingDry.changed, false);

for (const mutate of [
  (state) => { state.headers[0].description = 'Changed wording'; },
  (state) => { state.headers[0].version_number = 3; },
  (state) => { state.headers[0].status = 'ACTIVE'; },
  (state) => { state.questions.pop(); },
  (state) => { state.questions[0].metadata.output_variables = ['other_key']; },
  (state) => { state.questions[0].metadata.questionnaire_import.fixtureHash = 'a'.repeat(64); },
  (state) => { state.questions[0].question_text = 'Existing author edit'; },
  (state) => { state.questions[0].options = ['Changed']; },
  (state) => { state.questions[0].metadata.extraAuthoredField = true; }
]) {
  const conflict = harness({ headers: structuredClone(created.state.headers), questions: structuredClone(created.state.questions) });
  mutate(conflict.state); const before = structuredClone({ headers: conflict.state.headers, questions: conflict.state.questions });
  await assert.rejects(importQuestionnaireVersion(conflict.db, fixture, applyOptions), { code: 'QUESTIONNAIRE_EXISTING_CONTENT_CONFLICT' });
  assert.equal(conflict.state.writes, 0); assert.deepEqual({ headers: conflict.state.headers, questions: conflict.state.questions }, before);
}
for (const apply of [false, true]) {
  const used = harness({ headers: structuredClone(created.state.headers), questions: structuredClone(created.state.questions), used: 1 });
  await assert.rejects(importQuestionnaireVersion(used.db, fixture, { ...applyOptions, apply }), { code: 'QUESTIONNAIRE_ALREADY_USED' });
  assert.equal(used.state.writes, 0);
}
for (const overrides of [{ unique: false }, { columns: columns.filter((column) => column.column_name !== 'metadata') },
  { columns: columns.map((column) => column.column_name === 'metadata' ? { ...column, data_type: 'json' } : column) },
  { columns: [...columns, { table_name: 'questions', column_name: 'unknown_required_field', data_type: 'text', not_null: true, default_expression: null }] },
  { columns: columns.map((column) => column.column_name === 'id' ? { ...column, default_expression: null } : column) }]) {
  const unsupported = harness(overrides);
  await assert.rejects(importQuestionnaireVersion(unsupported.db, fixture, applyOptions), (error) => ['QUESTIONNAIRE_UNIQUE_IDENTITY_REQUIRED', 'QUESTIONNAIRE_SCHEMA_UNSUPPORTED'].includes(error.code));
  assert.equal(unsupported.state.writes, 0); assert.equal(unsupported.state.rolledBack, true);
}
for (const overrides of [{ failQuestion: 1 }, { failQuestion: 6 }, { failQuestion: 10 }, { failCommit: true }]) {
  const failed = harness(overrides);
  await assert.rejects(importQuestionnaireVersion(failed.db, fixture, applyOptions), /Injected/);
  assert.deepEqual(failed.state.headers, []); assert.deepEqual(failed.state.questions, []); assert.equal(failed.state.rolledBack, true); assert.equal(failed.state.released, 1);
}
for (const options of [{ apply: true }, { ...applyOptions, createdBy: 'not-a-user' }, { ...applyOptions, expectedFixtureHash: 'a'.repeat(64) }, { apply: 'yes' }]) {
  const rejected = harness(); await assert.rejects(importQuestionnaireVersion(rejected.db, fixture, options)); assert.equal(rejected.state.connections, 0);
}
for (const args of [[], ['--apply'], ['--fixture', 'fixture.json', '--apply'], ['--fixture', 'fixture.json', '--apply', '--expected-fixture-hash', prepared.fixtureHash],
  ['--fixture', 'fixture.json', '--created-by', 'not-a-user'], ['--fixture', 'fixture.json', '--api-root', '/'],
  ['--fixture', 'fixture.json', '--dry-run', '--apply'], ['--fixture', 'fixture.json', '--unknown'], ['--fixture', 'fixture.json', '--fixture', 'other.json']]) assert.throws(() => parseArguments(args));
for (const overrides of [{ denyActor: true }, { actorRole: 'CAMPAIGN_MANAGER' }]) {
  const denied = harness(overrides);
  await assert.rejects(importQuestionnaireVersion(denied.db, fixture, applyOptions), { code: 'QUESTIONNAIRE_CREATOR_NOT_AUTHORIZED' });
  assert.equal(denied.state.writes, 0); assert.equal(denied.state.rolledBack, true);
}
assert.equal(parseArguments(['--fixture', 'fixture.json', '--created-by', actorId]).apply, false);
assert.equal(parseArguments(['--fixture', 'fixture.json', '--apply', '--expected-fixture-hash', prepared.fixtureHash, '--created-by', actorId]).createdBy, actorId);
let adapterLoads = 0;
await assert.rejects(runCli(['--fixture', 'fixture.json', '--created-by', actorId, '--expected-fixture-hash', 'a'.repeat(64)], { read: async () => JSON.stringify(fixture), loadAdapter: async () => { adapterLoads++; } }), { code: 'QUESTIONNAIRE_FIXTURE_HASH_MISMATCH' });
assert.equal(adapterLoads, 0, 'All local fixture/hash guards precede runtime adapter/database access');
const cli = harness(); let ended = 0, output = null;
await runCli(['--fixture', 'fixture.json', '--created-by', actorId], { read: async () => JSON.stringify(fixture), loadAdapter: async () => ({ getDb: async () => ({ ...cli.db, end: async () => { ended++; } }) }), write: (value) => { output = JSON.parse(value); } });
assert.equal(output.mode, 'DRY_RUN'); assert.equal(ended, 1); assert.equal(cli.state.writes, 0);

if (process.env.PGLITE_MODULE_PATH) {
  const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE_PATH).href), engine = new PGlite();
  const queries = [], db = { connect: async () => ({ query: async (...args) => { queries.push(args[0]); return engine.query(...args); }, release() {} }) };
  try {
    await engine.exec(`
      CREATE TABLE roles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text NOT NULL, is_active boolean NOT NULL);
      CREATE TABLE users (id uuid PRIMARY KEY, role_id uuid NOT NULL REFERENCES roles(id), status text NOT NULL);
      CREATE TABLE questionnaires (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), questionnaire_code varchar(160) NOT NULL UNIQUE,
        questionnaire_name varchar(300) NOT NULL, description text, version_number integer NOT NULL, primary_language varchar(80),
        status varchar(30) NOT NULL, created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE questions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), questionnaire_id uuid NOT NULL REFERENCES questionnaires(id),
        question_order integer NOT NULL, question_code varchar(160), question_text text NOT NULL, question_type varchar(50) NOT NULL,
        options jsonb NOT NULL, required boolean NOT NULL, analysis_category varchar(160), metadata jsonb NOT NULL,
        UNIQUE(questionnaire_id, question_order), UNIQUE(questionnaire_id, question_code));
      CREATE TABLE program_iterations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), questionnaire_id uuid REFERENCES questionnaires(id));
    `);
    const roleId = (await engine.query("INSERT INTO roles(code, is_active) VALUES ('SUPER_ADMIN', TRUE) RETURNING id")).rows[0].id;
    await engine.query("INSERT INTO users(id, role_id, status) VALUES ($1, $2, 'ACTIVE')", [actorId, roleId]);
    assert.equal((await importQuestionnaireVersion(db, fixture)).mode, 'DRY_RUN');
    assert.equal((await engine.query('SELECT COUNT(*)::int AS count FROM questionnaires')).rows[0].count, 0);
    const actual = await importQuestionnaireVersion(db, fixture, applyOptions);
    assert.equal(actual.mode, 'CREATED'); assert.equal(actual.questionCount, 10);
    const stored = (await engine.query('SELECT * FROM questions ORDER BY question_order')).rows;
    assert.equal(stored.length, 10); assert.deepEqual(stored[9].metadata.reporting_contract, fixture.questions[9].reportingContract);
    assert.equal((await importQuestionnaireVersion(db, fixture, applyOptions)).mode, 'ALREADY_PRESENT');
    await engine.query('INSERT INTO program_iterations(questionnaire_id) VALUES ($1)', [actual.questionnaireId]);
    await assert.rejects(importQuestionnaireVersion(db, fixture, applyOptions), { code: 'QUESTIONNAIRE_ALREADY_USED' });
    const other = structuredClone(fixture); other.questionnaireCode = 'NEW_ATOMIC_FAILURE_V2';
    await engine.exec('ALTER TABLE questions ADD CONSTRAINT fail_tenth_question CHECK (question_order <> 10) NOT VALID');
    await assert.rejects(importQuestionnaireVersion(db, other, { ...applyOptions, expectedFixtureHash: hashQuestionnaireFixture(other) }));
    assert.equal((await engine.query('SELECT COUNT(*)::int AS count FROM questionnaires WHERE questionnaire_code = $1', [other.questionnaireCode])).rows[0].count, 0, 'A real PostgreSQL insert failure rolls back the header and nine earlier questions');
    assert.equal((await engine.query('SELECT COUNT(*)::int AS count FROM questions')).rows[0].count, 10);
    assert.ok(!queries.some((sql) => /^(?:UPDATE|DELETE|TRUNCATE|ALTER|DROP)\b/i.test(sql.trim())), 'Importer never writes existing instruments or schema');
    console.log('Questionnaire-version PostgreSQL engine atomic creation, exact idempotence, usage lock, JSONB contracts and rollback passed.');
  } finally { await engine.close(); }
}
console.log('Questionnaire-version fixture guards, schema checks, read-only dry run, attributed atomic import, conflict refusal and CLI tests passed.');
