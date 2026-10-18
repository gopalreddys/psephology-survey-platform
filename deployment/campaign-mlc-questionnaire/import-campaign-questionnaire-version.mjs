import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateReportingContract } from '../research-reporting-foundation/reporting-contract.validation.js';
import { buildQuestionnaireContentSnapshot } from '../research-methodology/questionnaire-snapshot.repository.js';
import { inspectInstrument } from '../interview-completion/interview-completion.js';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const HEX = /^[a-f0-9]{64}$/;
const OUTPUT = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
const CODE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/;
const FIXTURE_ID = '00000000-0000-4000-8000-000000000002';
const PROVENANCE = 'NEW_UNUSED_QUESTIONNAIRE_FIXTURE_V1';
const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
const same = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
function fail(code) { throw Object.assign(new Error(code), { code }); }
function text(value, maximum = 10000, allowEmpty = false) {
  if (typeof value !== 'string' || value.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)
    || (!allowEmpty && !value.trim())) fail('QUESTIONNAIRE_FIXTURE_INVALID');
  return value;
}

export function hashQuestionnaireFixture(fixture) {
  return createHash('sha256').update(JSON.stringify(canonical(fixture))).digest('hex');
}

export function validateQuestionnaireFixture(fixture) {
  if (!fixture || typeof fixture !== 'object' || Array.isArray(fixture)
    || !CODE.test(fixture.questionnaireCode || '') || !Number.isSafeInteger(fixture.versionNumber) || fixture.versionNumber < 2
    || !Array.isArray(fixture.questions) || fixture.questions.length !== 10
    || fixture.sourceBoundary !== 'NEW_UNUSED_INSTRUMENT_ONLY_NO_HISTORICAL_REWRITE'
    || fixture.configurationStatus !== 'DRAFT_NOT_LAUNCH_APPROVED') fail('QUESTIONNAIRE_FIXTURE_INVALID');
  text(fixture.questionnaireName, 300); text(fixture.description, 5000); text(fixture.primaryLanguage, 80);
  const fixtureHash = hashQuestionnaireFixture(fixture), codes = new Set(), outputs = new Set(), reports = new Set();
  const questions = fixture.questions.map((question, index) => {
    if (!question || typeof question !== 'object' || Array.isArray(question)
      || question.questionOrder !== index + 1 || !CODE.test(question.questionCode || '')
      || codes.has(question.questionCode.toUpperCase()) || !['OPEN_TEXT', 'SINGLE_CHOICE'].includes(question.questionType)
      || typeof question.required !== 'boolean' || typeof question.requiredForCompletion !== 'boolean'
      || !Array.isArray(question.options) || !Array.isArray(question.outputVariables) || !question.outputVariables.length
      || question.outputVariables.length > 10 || question.outputVariables.some((key) => typeof key !== 'string' || key.length > 80 || !OUTPUT.test(key) || outputs.has(key))
      || new Set(question.outputVariables).size !== question.outputVariables.length) fail('QUESTIONNAIRE_FIXTURE_INVALID');
    codes.add(question.questionCode.toUpperCase()); question.outputVariables.forEach((key) => outputs.add(key));
    text(question.questionText); text(question.questionTextTelugu); text(question.analysisCategory, 160); text(question.section, 160);
    if (question.askIf !== undefined) { text(question.askIf, 2000); if (question.requiredForCompletion) fail('QUESTIONNAIRE_REQUIRED_CONDITIONAL_UNSUPPORTED'); }
    const options = structuredClone(question.options);
    if (options.length > 40 || options.some((option) => !option || typeof option !== 'object' || Array.isArray(option)
      || Object.keys(option).some((key) => !['value', 'label', 'labelTelugu'].includes(key))
      || typeof option.value !== 'string' || !option.value.trim() || option.value.length > 120
      || typeof option.label !== 'string' || !option.label.trim() || option.label.length > 300
      || (option.labelTelugu !== undefined && (typeof option.labelTelugu !== 'string' || !option.labelTelugu.trim() || option.labelTelugu.length > 300)))
      || new Set(options.map((option) => option.value)).size !== options.length
      || (question.questionType === 'OPEN_TEXT' && options.length)
      || (question.questionType === 'SINGLE_CHOICE' && options.length < 2)) fail('QUESTIONNAIRE_OPTIONS_INVALID');
    const metadata = { question_text_telugu: question.questionTextTelugu, required_for_completion: question.requiredForCompletion,
      section: question.section, output_variables: [...question.outputVariables],
      questionnaire_import: { provenance: PROVENANCE, fixtureHash } };
    if (question.askIf !== undefined) metadata.askIf = question.askIf;
    if (question.reportingContract !== undefined) {
      const contract = validateReportingContract(question.reportingContract);
      if (!same([...contract.outputVariables].sort(), [...question.outputVariables].sort()) || reports.has(contract.reportKey)) fail('QUESTIONNAIRE_REPORT_MAPPING_INVALID');
      reports.add(contract.reportKey); metadata.reporting_contract = contract;
      if (question.questionType === 'SINGLE_CHOICE' && contract.valueType === 'CATEGORICAL'
        && contract.allowedValues.some((value) => !options.some((option) => option.value === value))) fail('QUESTIONNAIRE_OPTIONS_CONTRACT_CONFLICT');
    } else {
      if (question.reportingStatus !== 'CONTEXT_ONLY_NO_NATIVE_REPORT_CONTRACT' || !Array.isArray(fixture.contextOnlyQuestionCodes)
        || !fixture.contextOnlyQuestionCodes.includes(question.questionCode)) fail('QUESTIONNAIRE_REPORT_MAPPING_INVALID');
      metadata.reporting_status = question.reportingStatus;
      if (question.reportingNote !== undefined) metadata.reporting_note = text(question.reportingNote, 2000);
    }
    return { question_order: question.questionOrder, question_code: question.questionCode, question_text: question.questionText,
      question_type: question.questionType, options, required: question.required, analysis_category: question.analysisCategory, metadata };
  });
  if (fixture.reportingContractCount !== reports.size || fixture.contextOnlyQuestionCodes?.length !== questions.length - reports.size
    || fixture.contextOnlyQuestionCodes.some((code) => !codes.has(code.toUpperCase()))) fail('QUESTIONNAIRE_REPORT_MAPPING_INVALID');
  const header = { questionnaire_code: fixture.questionnaireCode, questionnaire_name: fixture.questionnaireName,
    description: fixture.description, version_number: fixture.versionNumber, primary_language: fixture.primaryLanguage, status: 'DRAFT' };
  const snapshot = buildQuestionnaireContentSnapshot({ id: FIXTURE_ID, ...header }, questions);
  const inspected = inspectInstrument({ questionnaire_id: FIXTURE_ID, questionnaire_snapshot: snapshot });
  if (inspected.reason !== null) fail('QUESTIONNAIRE_COMPLETION_CONTRACT_INVALID');
  return { fixtureHash, header, questions, reportingContracts: reports.size,
    requiredQuestions: questions.filter((question) => question.metadata.required_for_completion).length };
}

const expectedColumns = {
  questionnaires: { id: ['uuid'], questionnaire_code: ['text', 'varchar'], questionnaire_name: ['text', 'varchar'],
    description: ['text', 'varchar'], version_number: ['int4'], primary_language: ['text', 'varchar'], status: ['text', 'varchar'], created_by: ['uuid'] },
  questions: { id: ['uuid'], questionnaire_id: ['uuid'], question_order: ['int4'], question_code: ['text', 'varchar'], question_text: ['text', 'varchar'],
    question_type: ['text', 'varchar'], options: ['jsonb'], required: ['bool'], analysis_category: ['text', 'varchar'], metadata: ['jsonb'] }
};
async function inspectSchema(client) {
  const found = await client.query(`
    SELECT relation.relname AS table_name, attribute.attname AS column_name, type.typname AS data_type,
      attribute.attnotnull AS not_null, pg_catalog.pg_get_expr(defaults.adbin, defaults.adrelid) AS default_expression,
      attribute.attgenerated AS generated, attribute.attidentity AS identity
    FROM pg_catalog.pg_class relation
    JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
    JOIN pg_catalog.pg_attribute attribute ON attribute.attrelid = relation.oid AND attribute.attnum > 0 AND NOT attribute.attisdropped
    JOIN pg_catalog.pg_type type ON type.oid = attribute.atttypid
    LEFT JOIN pg_catalog.pg_attrdef defaults ON defaults.adrelid = relation.oid AND defaults.adnum = attribute.attnum
    WHERE namespace.nspname = 'public' AND relation.relkind IN ('r', 'p') AND relation.relname IN ('questionnaires', 'questions')
  `);
  for (const [tableName, columns] of Object.entries(expectedColumns)) {
    const rows = found.rows.filter((row) => row.table_name === tableName), byName = new Map(rows.map((row) => [row.column_name, row]));
    if (Object.entries(columns).some(([name, types]) => !types.includes(byName.get(name)?.data_type)
      || byName.get(name)?.generated || byName.get(name)?.identity)
      || !byName.get('id')?.default_expression
      || rows.some((row) => !(row.column_name in columns) && row.not_null && !row.default_expression && !row.generated && !row.identity)) fail('QUESTIONNAIRE_SCHEMA_UNSUPPORTED');
  }
  const unique = await client.query(`
    SELECT EXISTS (
      SELECT 1 FROM pg_catalog.pg_index index
      JOIN pg_catalog.pg_class relation ON relation.oid = index.indrelid
      JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
      JOIN pg_catalog.pg_attribute code ON code.attrelid = relation.oid AND code.attname = 'questionnaire_code'
      JOIN pg_catalog.pg_attribute version ON version.attrelid = relation.oid AND version.attname = 'version_number'
      WHERE namespace.nspname = 'public' AND relation.relname = 'questionnaires'
        AND index.indisunique AND index.indisvalid AND index.indisready AND index.indimmediate
        AND index.indpred IS NULL AND index.indexprs IS NULL
        AND ((index.indnkeyatts = 1 AND index.indkey[0] = code.attnum)
          OR (index.indnkeyatts = 2 AND index.indkey[0] IN (code.attnum, version.attnum)
            AND index.indkey[1] IN (code.attnum, version.attnum) AND index.indkey[0] <> index.indkey[1]))
    ) AS identity_enforced
  `);
  if (unique.rows.length !== 1 || unique.rows[0].identity_enforced !== true) fail('QUESTIONNAIRE_UNIQUE_IDENTITY_REQUIRED');
}
const questionFields = ['question_order', 'question_code', 'question_text', 'question_type', 'options', 'required', 'analysis_category', 'metadata'];
function projectQuestion(row) { return Object.fromEntries(questionFields.map((key) => [key, row[key]])); }
async function retainedQuestions(client, id) {
  return (await client.query(`SELECT to_jsonb(question) AS question FROM public.questions question
    WHERE question.questionnaire_id = $1::uuid ORDER BY question.question_order, question.question_code`, [id])).rows.map((row) => row.question);
}

export async function importQuestionnaireVersion(db, fixture, { apply = false, expectedFixtureHash, createdBy } = {}) {
  if (typeof apply !== 'boolean' || (expectedFixtureHash !== undefined && !HEX.test(expectedFixtureHash))
    || (createdBy !== undefined && (typeof createdBy !== 'string' || !UUID.test(createdBy)))) fail('QUESTIONNAIRE_IMPORT_OPTIONS_INVALID');
  const prepared = validateQuestionnaireFixture(fixture);
  if (expectedFixtureHash !== undefined && expectedFixtureHash !== prepared.fixtureHash) fail('QUESTIONNAIRE_FIXTURE_HASH_MISMATCH');
  if (apply && (!expectedFixtureHash || !createdBy)) fail('QUESTIONNAIRE_APPLY_GUARDS_REQUIRED');
  const client = await db.connect(); let transaction = false;
  try {
    await client.query(apply ? 'BEGIN' : 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'); transaction = true;
    await client.query('SET LOCAL search_path = pg_catalog, public');
    await client.query("SET LOCAL lock_timeout = '10s'");
    if (createdBy) {
      const actor = await client.query(`SELECT user_record.id, role_record.code AS role_code
        FROM public.users user_record JOIN public.roles role_record ON role_record.id = user_record.role_id
        WHERE user_record.id = $1::uuid AND user_record.status = 'ACTIVE' AND role_record.is_active = TRUE
          AND role_record.code IN ('SUPER_ADMIN', 'ADMIN')${apply ? ' FOR SHARE OF user_record, role_record' : ''}`, [createdBy]);
      if (actor.rows.length !== 1 || actor.rows[0].id !== createdBy.toLowerCase()
        || !['SUPER_ADMIN', 'ADMIN'].includes(actor.rows[0].role_code)) fail('QUESTIONNAIRE_CREATOR_NOT_AUTHORIZED');
    }
    await inspectSchema(client);
    // This serializes cooperating imports. The inspected database UNIQUE index,
    // not this advisory lock, protects against a concurrent ordinary UI create.
    if (apply) await client.query('SELECT pg_catalog.pg_advisory_xact_lock($1, pg_catalog.hashtext($2))', [172020, prepared.header.questionnaire_code]);
    const headerResult = await client.query(`SELECT * FROM public.questionnaires WHERE questionnaire_code = $1${apply ? ' FOR UPDATE' : ''}`,
      [prepared.header.questionnaire_code]);
    if (headerResult.rows.length > 1) fail('QUESTIONNAIRE_IDENTITY_CONFLICT');
    let header = headerResult.rows[0], changed = false;
    if (header) {
      if (!same(Object.fromEntries(Object.keys(prepared.header).map((key) => [key, header[key]])), prepared.header)) fail('QUESTIONNAIRE_EXISTING_CONTENT_CONFLICT');
      const usage = await client.query('SELECT COUNT(*)::int AS used_by_iterations FROM public.program_iterations WHERE questionnaire_id = $1::uuid', [header.id]);
      if (usage.rows.length !== 1 || !Number.isSafeInteger(usage.rows[0].used_by_iterations) || usage.rows[0].used_by_iterations < 0) fail('QUESTIONNAIRE_USAGE_UNAVAILABLE');
      if (usage.rows[0].used_by_iterations > 0) fail('QUESTIONNAIRE_ALREADY_USED');
      const stored = await retainedQuestions(client, header.id);
      if (!same(stored.map(projectQuestion), prepared.questions)) fail('QUESTIONNAIRE_EXISTING_CONTENT_CONFLICT');
    } else if (apply) {
      const values = [prepared.header.questionnaire_code, prepared.header.questionnaire_name, prepared.header.description,
        prepared.header.version_number, prepared.header.primary_language, createdBy];
      const inserted = await client.query(`INSERT INTO public.questionnaires
        (questionnaire_code, questionnaire_name, description, version_number, primary_language, status, created_by)
        VALUES ($1, $2, $3, $4, $5, 'DRAFT', $6::uuid) RETURNING *`, values);
      if (inserted.rows.length !== 1 || !UUID.test(inserted.rows[0].id || '')) fail('QUESTIONNAIRE_INSERT_POSTCHECK_FAILED');
      header = inserted.rows[0];
      for (const question of prepared.questions) {
        const result = await client.query(`INSERT INTO public.questions
          (questionnaire_id, question_order, question_code, question_text, question_type, options, required, analysis_category, metadata)
          VALUES ($1::uuid, $2, $3, $4, $5, $6::jsonb, $7, $8, $9::jsonb) RETURNING id`,
        [header.id, question.question_order, question.question_code, question.question_text, question.question_type,
          JSON.stringify(question.options), question.required, question.analysis_category, JSON.stringify(question.metadata)]);
        if (result.rows.length !== 1 || !UUID.test(result.rows[0].id || '')) fail('QUESTIONNAIRE_INSERT_POSTCHECK_FAILED');
      }
      const stored = await retainedQuestions(client, header.id);
      if (!same(stored.map(projectQuestion), prepared.questions)
        || !same(Object.fromEntries(Object.keys(prepared.header).map((key) => [key, header[key]])), prepared.header)) fail('QUESTIONNAIRE_INSERT_POSTCHECK_FAILED');
      changed = true;
    }
    const result = { mode: apply ? changed ? 'CREATED' : 'ALREADY_PRESENT' : 'DRY_RUN', changed,
      action: header ? changed ? 'NEW_UNUSED_DRAFT_CREATED' : 'EXACT_UNUSED_DRAFT_ALREADY_PRESENT' : 'NEW_UNUSED_DRAFT_WOULD_BE_CREATED',
      questionnaireId: header?.id || null, code: prepared.header.questionnaire_code, version: prepared.header.version_number,
      fixtureHash: prepared.fixtureHash, questionCount: prepared.questions.length, reportingContractCount: prepared.reportingContracts,
      requiredQuestionCount: prepared.requiredQuestions, existingQuestionnairesChanged: false, iterationsAssigned: false,
      creatorVerified: Boolean(createdBy), providerUpdated: false, agentCommitted: false, callsLaunched: false, launchApproved: false };
    await client.query('COMMIT'); transaction = false; return result;
  } catch (error) { if (transaction) { try { await client.query('ROLLBACK'); } catch { /* Retain the original failure. */ } } throw error; }
  finally { client.release(); }
}

export function parseArguments(args) {
  const options = { apply: false, apiRoot: '/opt/sarvam-voice-analytics' }, seen = new Set();
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (!['--dry-run', '--apply', '--fixture', '--api-root', '--expected-fixture-hash', '--created-by'].includes(key) || seen.has(key)) fail('QUESTIONNAIRE_IMPORT_ARGUMENTS_INVALID');
    seen.add(key); if (key === '--dry-run') continue; if (key === '--apply') { options.apply = true; continue; }
    const value = args[++index]; if (typeof value !== 'string' || !value || value.startsWith('--')) fail('QUESTIONNAIRE_IMPORT_ARGUMENTS_INVALID');
    options[({ '--fixture': 'fixturePath', '--api-root': 'apiRoot', '--expected-fixture-hash': 'expectedFixtureHash', '--created-by': 'createdBy' })[key]] = value;
  }
  if ((seen.has('--dry-run') && options.apply) || !options.fixturePath || !options.createdBy || !path.isAbsolute(options.apiRoot)
    || path.resolve(options.apiRoot) === path.parse(options.apiRoot).root
    || (options.expectedFixtureHash !== undefined && !HEX.test(options.expectedFixtureHash))
    || (options.createdBy !== undefined && !UUID.test(options.createdBy))
    || (options.apply && (!options.expectedFixtureHash || !options.createdBy))) fail('QUESTIONNAIRE_IMPORT_ARGUMENTS_INVALID');
  return options;
}

export async function runCli(args, { read = (filename) => readFile(filename, 'utf8'),
  loadAdapter = (root) => import(pathToFileURL(path.join(root, 'src/db/postgres.js')).href), write = console.log } = {}) {
  const options = parseArguments(args), fixture = JSON.parse(await read(options.fixturePath));
  const prepared = validateQuestionnaireFixture(fixture);
  if (options.expectedFixtureHash && prepared.fixtureHash !== options.expectedFixtureHash) fail('QUESTIONNAIRE_FIXTURE_HASH_MISMATCH');
  let db;
  try { db = await (await loadAdapter(options.apiRoot)).getDb(); const result = await importQuestionnaireVersion(db, fixture, options); write(JSON.stringify(result)); return result; }
  finally { if (db) await db.end(); }
}
const main = process.argv[1] && await realpath(process.argv[1]).then((filename) => filename === fileURLToPath(import.meta.url), () => false);
if (main) { try { await runCli(process.argv.slice(2)); } catch (error) {
  const code = typeof error?.code === 'string' && /^[A-Z0-9_]{1,80}$/.test(error.code) ? error.code : 'QUESTIONNAIRE_IMPORT_FAILED';
  console.error(JSON.stringify({ status: 'FAILED', code })); process.exitCode = 1;
} }
