// Isolated PostgreSQL-engine regression. No production database is contacted.
// Set PGLITE_MODULE_PATH to a test installation's @electric-sql/pglite/dist/index.js.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildQuestionnaireContentSnapshot } from './questionnaire-snapshot.repository.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const sqlDirectory = path.resolve(here, '../amazon-quick-enterprise-dashboard');
const modulePath = process.env.PGLITE_MODULE_PATH;
const { PGlite } = await import(modulePath ? pathToFileURL(path.resolve(modulePath)).href : '@electric-sql/pglite');
const db = new PGlite();
const migrations = await Promise.all([
  '028_research_design_comparability.sql',
  '029_shared_comparison_gate.sql',
  '031_audited_research_methodology.sql'
].map((file) => readFile(path.join(sqlDirectory, file), 'utf8')));
const uuid = (number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const campaignId = uuid(1);
const actorId = uuid(2);
const questionnaireId = uuid(3);
const iterationIds = [uuid(101), uuid(102)];
const questionnaire = {
  id: questionnaireId, questionnaire_code: 'RESEARCH-1', questionnaire_name: 'Research survey',
  version_number: 1, status: 'PUBLISHED'
};
const questions = [{
  id: uuid(201), question_code: 'Q1', question_order: 1,
  question_text: 'What issue matters most to you?', question_type: 'OPEN_TEXT',
  options: [], required: true, analysis_category: 'ISSUE_PRIORITY',
  metadata: { output_variables: ['issue_priority'] }
}];
const frozenSnapshot = buildQuestionnaireContentSnapshot(questionnaire, questions);
const completeDesign = {
  target_population: 'Registered voters in the Campaign constituency',
  sample_frame_name: 'Voter roll extract approved on 2026-10-01',
  sampling_method: 'QUOTA', selection_method: 'Select contacts by age and gender quota within each Mandal',
  cohort_design: 'INDEPENDENT_SAMPLES', weighting_status: 'NOT_REQUIRED',
  weighting_method: null, weighting_variables: [], fieldwork_mode: 'AI_ASSISTED_OUTBOUND_VOICE'
};

const gate = async () => (await db.query(
  'SELECT * FROM analytics_iteration_comparability_v1 WHERE iteration_id = $1', [iterationIds[1]]
)).rows[0];
const movement = async () => (await db.query(
  'SELECT * FROM analytics_iteration_movement_v1 WHERE iteration_id = $1', [iterationIds[1]]
)).rows[0];
const columns = async (table) => (await db.query(`SELECT column_name, data_type, udt_name
  FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position`, [table])).rows;
const registry = async (id) => (await db.query(
  'SELECT * FROM analytics_research_design_registry WHERE iteration_id = $1', [id]
)).rows[0];

async function resetDesigns() {
  for (const id of iterationIds) await db.query(`UPDATE analytics_research_design_registry SET
    target_population = $1, sample_frame_name = $2, sampling_method = $3,
    selection_method = $4, cohort_design = $5, weighting_status = $6,
    weighting_method = $7, weighting_variables = $8::jsonb, fieldwork_mode = $9,
    declared_by_user_id = $10, declared_at = '2026-10-08T10:00:00Z', revision = 1
    WHERE iteration_id = $11`, [
    completeDesign.target_population, completeDesign.sample_frame_name, completeDesign.sampling_method,
    completeDesign.selection_method, completeDesign.cohort_design, completeDesign.weighting_status,
    completeDesign.weighting_method, JSON.stringify(completeDesign.weighting_variables), completeDesign.fieldwork_mode,
    actorId, id
  ]);
}

async function setDesignField(field, value, ids) {
  for (const id of ids) await db.query(`UPDATE analytics_research_design_registry SET ${field} = $1 WHERE iteration_id = $2`, [value, id]);
}

async function assertSuppressed(label, options = {}) {
  const result = await gate();
  assert.equal(result.comparison_status, 'NOT_COMPARABLE', `${label}: method gate`);
  assert.ok(result.comparison_reasons.length > 0, `${label}: an explanation is required`);
  if (options.incompleteCurrent) assert.equal(result.design_declared, false, `${label}: current declaration is incomplete`);
  const resultMovement = await movement();
  assert.equal(resultMovement.comparison_basis, 'NOT_COMPARABLE', `${label}: movement basis`);
  for (const field of ['party_strength_change', 'positive_sentiment_change_pct', 'candidate_positive_change_pct']) {
    assert.equal(resultMovement[field], null, `${label}: ${field} remains suppressed`);
  }
}

try {
  await db.exec(`
    CREATE TABLE users (id uuid PRIMARY KEY);
    CREATE TABLE campaigns (id uuid PRIMARY KEY, campaign_code text, campaign_name text, status text);
    CREATE TABLE program_iterations (
      id uuid PRIMARY KEY, iteration_number integer, iteration_name text, questionnaire_id uuid,
      questionnaire_snapshot jsonb, created_at timestamptz, sample_design_type text
    );
    CREATE TABLE campaign_iteration_links (campaign_id uuid, iteration_id uuid UNIQUE, UNIQUE(campaign_id, iteration_id));
    CREATE TABLE analytics_research_enterprise_v1 (
      program_id uuid, program_code text, program_name text, campaign_id uuid, campaign_code text,
      campaign_name text, iteration_id uuid, iteration_number integer, iteration_name text,
      respondent_key text, direct_party_strength numeric, respondent_sentiment text,
      candidate_sentiment text, issue_priority text
    );
  `);
  await db.query('INSERT INTO users VALUES ($1)', [actorId]);
  await db.query("INSERT INTO campaigns VALUES ($1, 'C1', 'Campaign', 'ACTIVE')", [campaignId]);
  for (const [index, id] of iterationIds.entries()) {
    await db.query(`INSERT INTO program_iterations VALUES ($1, $2, $3, $4, $5::jsonb,
      '2026-10-01T10:00:00Z', 'REPEATED_CROSS_SECTION')`,
    [id, index + 1, `Iteration ${index + 1}`, questionnaireId, JSON.stringify(frozenSnapshot)]);
    await db.query('INSERT INTO campaign_iteration_links VALUES ($1, $2)', [campaignId, id]);
    for (let respondent = 0; respondent < 5; respondent++) {
      await db.query(`INSERT INTO analytics_research_enterprise_v1 VALUES (
        $1, 'PROGRAM', 'Program', $2, 'C1', 'Campaign', $3, $4, $5, $6,
        $7, $8, $8, 'Jobs')`, [uuid(8000), campaignId, id, index + 1,
        `Iteration ${index + 1}`, `${id}-respondent-${respondent}`, index + 2,
        respondent < index + 2 ? 'Positive' : 'Negative']);
    }
  }
  await db.exec(migrations[0]);
  await db.exec(migrations[1]);
  const legacySignatures = await Promise.all([
    columns('analytics_iteration_comparability_v1'), columns('analytics_iteration_movement_v1')
  ]);
  await db.exec(migrations[2]);
  const signatures = await Promise.all([
    columns('analytics_iteration_comparability_v1'), columns('analytics_iteration_movement_v1')
  ]);
  assert.deepEqual(signatures[0].slice(0, legacySignatures[0].length), legacySignatures[0], 'existing gate columns retain names, order and types');
  assert.deepEqual(signatures[1], legacySignatures[1], 'movement schema remains compatible');
  assert.ok((await columns('analytics_research_design_registry')).some((column) => column.column_name === 'revision' && column.data_type === 'integer'));
  assert.ok((await columns('analytics_research_design_registry')).some((column) => column.column_name === 'cohort_design'));
  assert.ok((await columns('analytics_research_design_audit')).some((column) => column.column_name === 'design_snapshot' && column.data_type === 'jsonb'));
  const auditForeignKeys = (await db.query(`SELECT confdeltype FROM pg_catalog.pg_constraint
    WHERE conrelid = 'analytics_research_design_audit'::regclass AND contype = 'f'`)).rows;
  assert.ok(auditForeignKeys.every((key) => key.confdeltype !== 'c'), 'source deletion cannot cascade into declaration audit history');
  await assertSuppressed('migration defaults', { incompleteCurrent: true });

  // A timestamp on migration defaults must never become a declaration.
  await setDesignField('declared_at', '2026-10-08T10:00:00Z', iterationIds);
  await setDesignField('declared_by_user_id', actorId, iterationIds);
  await setDesignField('revision', 1, iterationIds);
  await assertSuppressed('stamped default declarations', { incompleteCurrent: true });
  await resetDesigns();
  assert.equal((await gate()).comparison_status, 'COMPARABLE', 'matching complete declarations with frozen instruments pass');
  assert.equal((await gate()).design_declared, true);
  let resultMovement = await movement();
  assert.equal(resultMovement.comparison_basis, 'COMPARABLE');
  assert.equal(Number(resultMovement.party_strength_change), 1);
  assert.equal(Number(resultMovement.positive_sentiment_change_pct), 20);
  assert.equal(Number(resultMovement.candidate_positive_change_pct), 20);

  // Test each side and both sides. Equality between absent fields cannot qualify.
  for (const [field, value] of [
    ['target_population', ''], ['target_population', '  '], ['target_population', 'Not declared'],
    ['sample_frame_name', null], ['sample_frame_name', '  '], ['sample_frame_name', 'Not declared'],
    ['selection_method', null], ['selection_method', '  '], ['selection_method', 'Not declared'],
    ['cohort_design', 'NOT_DECLARED'], ['fieldwork_mode', '  '],
    ['weighting_status', 'NOT_CONFIGURED'], ['declared_at', null],
    ['declared_by_user_id', null], ['revision', 0]
  ]) {
    for (const ids of [[iterationIds[0]], [iterationIds[1]], iterationIds]) {
      await setDesignField(field, value, ids);
      await assertSuppressed(`incomplete ${field} for ${ids.length === 2 ? 'both' : ids[0] === iterationIds[0] ? 'previous' : 'current'} wave`, { incompleteCurrent: ids.includes(iterationIds[1]) });
      await resetDesigns();
    }
  }
  for (const cohort of ['SAME_PARTICIPANTS', 'PARTIAL_OVERLAP']) {
    await setDesignField('cohort_design', cohort, [iterationIds[1]]);
    await assertSuppressed(`cohort differs: ${cohort}`);
    assert.ok((await gate()).comparison_reasons.some((reason) => /cohort/i.test(reason)), 'cohort difference must be explained');
    await resetDesigns();
  }
  // APPLIED must not be accepted before a validated weighting pipeline exists.
  await setDesignField('weighting_status', 'APPLIED', iterationIds);
  await setDesignField('weighting_method', 'Raking by age and gender', iterationIds);
  await setDesignField('weighting_variables', JSON.stringify(['age', 'gender']), iterationIds);
  await assertSuppressed('metadata alone cannot claim applied weights', { incompleteCurrent: true });
  await resetDesigns();

  for (const snapshot of [
    { id: questionnaireId, code: 'RESEARCH-1', version: 1 },
    { ...frozenSnapshot, questions: undefined },
    { ...frozenSnapshot, questions: null },
    { ...frozenSnapshot, questions: [] },
    { ...frozenSnapshot, questions: {} },
    { ...frozenSnapshot, questions: [null] },
    { ...frozenSnapshot, questions: ['Unrecorded question'] },
    { ...frozenSnapshot, questions: [{ ...frozenSnapshot.questions[0], question_code: ' ' }] },
    { ...frozenSnapshot, questions: [{ ...frozenSnapshot.questions[0], question_text: ' ' }] },
    { ...frozenSnapshot, snapshot_schema_version: undefined },
    { ...frozenSnapshot, snapshot_schema_version: 1 },
    { ...frozenSnapshot, question_provenance: undefined },
    { ...frozenSnapshot, question_provenance: 'INFERRED_FROM_CURRENT_QUESTIONNAIRE' },
    { ...frozenSnapshot, content_fingerprint: undefined },
    { ...frozenSnapshot, content_fingerprint: ' ' },
    { ...frozenSnapshot, content_fingerprint: 'not-a-content-fingerprint' }
  ]) {
    for (const ids of [[iterationIds[0]], [iterationIds[1]], iterationIds]) {
      for (const id of ids) await db.query('UPDATE program_iterations SET questionnaire_snapshot = $1::jsonb WHERE id = $2', [JSON.stringify(snapshot), id]);
      await assertSuppressed(`absent frozen question content: ${JSON.stringify(snapshot)}`);
      for (const id of ids) await db.query('UPDATE program_iterations SET questionnaire_snapshot = $1::jsonb WHERE id = $2', [JSON.stringify(frozenSnapshot), id]);
    }
  }
  const changedQuestions = [{ ...questions[0], question_text: 'Which party do you support?' }];
  await db.query('UPDATE program_iterations SET questionnaire_snapshot = $1::jsonb WHERE id = $2',
    [JSON.stringify(buildQuestionnaireContentSnapshot(questionnaire, changedQuestions)), iterationIds[1]]);
  await assertSuppressed('changed frozen question wording');
  await db.query('UPDATE program_iterations SET questionnaire_snapshot = $1::jsonb WHERE id = $2', [JSON.stringify(frozenSnapshot), iterationIds[1]]);

  // Audit snapshots and revision identity survive the migration runner's full replay.
  const originalDesign = await registry(iterationIds[1]);
  await db.query(`INSERT INTO analytics_research_design_audit (
    iteration_id, campaign_id, revision, actor_user_id, change_reason, design_snapshot, declared_at
  ) VALUES ($1, $2, 1, $3, 'Initial documented methodology', $4::jsonb, $5)`, [
    iterationIds[1], campaignId, actorId, JSON.stringify(originalDesign), originalDesign.declared_at
  ]);
  await assert.rejects(db.query('UPDATE analytics_research_design_audit SET change_reason = $1 WHERE iteration_id = $2',
    ['Overwrite reviewed history', iterationIds[1]]), 'reviewed audit rows cannot be overwritten');
  await assert.rejects(db.query('DELETE FROM analytics_research_design_audit WHERE iteration_id = $1',
    [iterationIds[1]]), 'reviewed audit rows cannot be deleted');
  await assert.rejects(db.query('TRUNCATE analytics_research_design_audit'),
    'reviewed audit history cannot be truncated');
  await assert.rejects(db.query(`INSERT INTO analytics_research_design_audit (
    iteration_id, campaign_id, revision, actor_user_id, change_reason, design_snapshot, declared_at
  ) VALUES ($1, $2, 1, $3, 'Duplicate revision', '{}'::jsonb, now())`, [iterationIds[1], campaignId, actorId]),
  (error) => error.code === '23505', 'an Iteration revision cannot be reused');
  for (const sql of migrations) await db.exec(sql);
  assert.deepEqual(await Promise.all([
    columns('analytics_iteration_comparability_v1'), columns('analytics_iteration_movement_v1')
  ]), signatures, 'complete SQL replay preserves view signatures');
  assert.deepEqual(await registry(iterationIds[1]), originalDesign, 'migration replay does not rewrite reviewed declarations');
  const auditRows = (await db.query('SELECT * FROM analytics_research_design_audit WHERE iteration_id = $1', [iterationIds[1]])).rows;
  assert.equal(auditRows.length, 1, 'replay does not manufacture or duplicate audit events');
  assert.equal(auditRows[0].revision, 1);
  assert.equal(auditRows[0].actor_user_id, actorId);
  assert.equal(auditRows[0].design_snapshot.target_population, originalDesign.target_population);
  assert.equal((await gate()).comparison_status, 'COMPARABLE', 'replay retains the strengthened gate');

  resultMovement = await movement();
  assert.match(resultMovement.interpretation_label, /aggregate|directional/i);
  assert.match(resultMovement.interpretation_label, /not a causal/i);
  assert.doesNotMatch(resultMovement.interpretation_label, /statistically significant|representative sample|margin of error|confidence interval/i);
  assert.ok((await columns('analytics_iteration_movement_v1')).every((column) =>
    !/margin_of_error|confidence_interval|p_value|standard_error|effective_sample_size/i.test(column.column_name)),
  'five responses are a disclosure guard; no statistical precision is invented');
  console.log('Audited methodology SQL passed: incomplete/default declarations, frozen question content, cohort parity, applied-weight refusal, audit identity and replay.');
} catch (error) {
  console.error(`Audited methodology SQL failed (${error.code || error.name}): ${error.message}`);
  process.exitCode = 1;
} finally {
  await db.close();
}
