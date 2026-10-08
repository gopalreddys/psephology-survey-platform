// Run with PGLITE_MODULE_PATH pointing to an isolated PGlite dist/index.js,
// or install @electric-sql/pglite in a test environment. No live DB is contacted.
// Optional --legacy-git-head also exercises an upgrade from the tracked 028 SQL.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(here, '../..');
const sqlDirectory = path.resolve(here, '../amazon-quick-enterprise-dashboard');
const modulePath = process.env.PGLITE_MODULE_PATH;
const { PGlite } = await import(modulePath ? pathToFileURL(path.resolve(modulePath)).href : '@electric-sql/pglite');
const db = new PGlite();
const migrations = await Promise.all(['028_research_design_comparability.sql', '029_shared_comparison_gate.sql']
  .map((file) => readFile(path.join(sqlDirectory, file), 'utf8')));
const decisionSql = await readFile(path.join(sqlDirectory, '027_psephology_decision_reporting.sql'), 'utf8');
const bootstrapStart = decisionSql.indexOf('-- Bootstrap only.');
const previousMovementSql = decisionSql.slice(bootstrapStart === -1 ? decisionSql.indexOf('CREATE OR REPLACE VIEW analytics_iteration_movement_v1') : bootstrapStart, decisionSql.lastIndexOf('COMMIT;'));
assert.match(previousMovementSql, /CREATE (?:OR REPLACE )?VIEW analytics_iteration_movement_v1/);

function uuid(number) { return `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`; }
const questionnaireId = uuid(9000);
const frozenQuestionnaire = { code: 'SURVEY-1', name: 'Survey', version: 1, status: 'PUBLISHED' };
const campaignId = uuid(1);
const waveIds = [uuid(101), uuid(102), uuid(103)];

async function comparability(iterationId) {
  return (await db.query('SELECT * FROM analytics_iteration_comparability_v1 WHERE iteration_id = $1', [iterationId])).rows[0];
}
async function movement(iterationId) {
  return (await db.query('SELECT * FROM analytics_iteration_movement_v1 WHERE iteration_id = $1', [iterationId])).rows[0];
}
async function signature(view) {
  return (await db.query(`SELECT column_name, data_type, udt_name
    FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position`, [view])).rows;
}
async function addCampaign(id, numbers, options = {}) {
  await db.query('INSERT INTO campaigns VALUES ($1, $2, $3, $4)', [id, `C-${id}`, 'Campaign', options.status || 'ACTIVE']);
  const ids = numbers.map((number, index) => options.ids?.[index] || uuid(1000 + Number(id.slice(-12)) * 10 + number));
  for (let index = 0; index < numbers.length; index++) {
    const number = numbers[index];
    const iterationId = ids[index];
    await db.query(`INSERT INTO program_iterations
      (id, iteration_number, iteration_name, questionnaire_id, questionnaire_snapshot, created_at, sample_design_type)
      VALUES ($1, $2, $3, $4, $5::jsonb, now(), 'Repeated cross-section')`,
    [iterationId, number, `Iteration ${number}`, questionnaireId, JSON.stringify(frozenQuestionnaire)]);
    await db.query('INSERT INTO campaign_iteration_links VALUES ($1, $2)', [id, iterationId]);
  }
  return ids;
}
async function declareDesign(iterationIds) {
  for (const id of iterationIds) {
    await db.query(`INSERT INTO analytics_research_design_registry (
      iteration_id, campaign_id, target_population, sample_frame_name, sampling_method,
      selection_method, weighting_status, weighting_method, weighting_variables, fieldwork_mode, declared_at
    ) SELECT id, link.campaign_id, 'Registered voters', 'Voter roll', 'QUOTA',
      'Repeated cross-section', 'NOT_REQUIRED', NULL, '[]'::jsonb, 'AI_ASSISTED_OUTBOUND_VOICE', now()
    FROM program_iterations iteration JOIN campaign_iteration_links link ON link.iteration_id = iteration.id
    WHERE iteration.id = $1
    ON CONFLICT (iteration_id) DO UPDATE SET
      target_population = EXCLUDED.target_population,
      sample_frame_name = EXCLUDED.sample_frame_name, sampling_method = EXCLUDED.sampling_method,
      selection_method = EXCLUDED.selection_method, weighting_status = EXCLUDED.weighting_status,
      weighting_method = EXCLUDED.weighting_method, weighting_variables = EXCLUDED.weighting_variables,
      fieldwork_mode = EXCLUDED.fieldwork_mode, declared_at = EXCLUDED.declared_at`, [id]);
  }
}
async function evidence(id, count, options = {}) {
  const { rows: [wave] } = await db.query(`SELECT iteration.*, campaign.id AS campaign_id,
      campaign.campaign_code, campaign.campaign_name
    FROM program_iterations iteration JOIN campaign_iteration_links link ON link.iteration_id = iteration.id
    JOIN campaigns campaign ON campaign.id = link.campaign_id WHERE iteration.id = $1`, [id]);
  for (let index = 0; index < count; index++) {
    await db.query(`INSERT INTO analytics_research_enterprise_v1 VALUES (
      $1, 'PROGRAM', 'Program', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'Jobs'
    )`, [uuid(8000), wave.campaign_id, wave.campaign_code, wave.campaign_name,
      id, wave.iteration_number, wave.iteration_name, `${id}-respondent-${index}`,
      index < (options.directBase ?? count) ? (options.strength ?? 3) : null,
      index < (options.positiveCount ?? count) ? 'Positive' : 'Negative',
      index < (options.candidatePositiveCount ?? count) ? 'Positive' : 'Negative']);
  }
}
function noMovement(row, label) {
  assert.ok(row, label);
  assert.equal(row.party_strength_change, null, `${label}: direct movement`);
  assert.equal(row.positive_sentiment_change_pct, null, `${label}: respondent movement`);
  assert.equal(row.candidate_positive_change_pct, null, `${label}: candidate movement`);
}
function hasReason(row, phrase) { assert.ok(row.comparison_reasons.some((reason) => reason.toLowerCase().includes(phrase.toLowerCase())), row.comparison_reasons.join('; ')); }

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
      respondent_key text, direct_party_strength numeric, respondent_sentiment text, candidate_sentiment text,
      issue_priority text
    );
  `);
  await addCampaign(campaignId, [1, 2, 3], { ids: waveIds });
  await db.exec(previousMovementSql);
  let legacyColumns;
  if (process.argv.includes('--legacy-git-head')) {
    const legacy = execFileSync('git', ['show', 'HEAD:deployment/amazon-quick-enterprise-dashboard/028_research_design_comparability.sql'], { cwd: repository, encoding: 'utf8' });
    await db.exec(legacy);
    legacyColumns = [await signature('analytics_iteration_comparability_v1'), await signature('analytics_iteration_movement_v1')];
  }
  await db.exec(migrations[0]);
  await db.exec(migrations[1]);
  const columns = [await signature('analytics_iteration_comparability_v1'), await signature('analytics_iteration_movement_v1')];
  if (legacyColumns) {
    assert.deepEqual(columns[0].slice(0, legacyColumns[0].length), legacyColumns[0], '028 existing comparability columns retain their names, positions and types');
    assert.deepEqual(columns[1], legacyColumns[1], '028 existing movement columns retain their names, positions and types');
  }
  assert.equal(columns[0].at(-1).column_name, 'previous_iteration_id');

  assert.equal((await comparability(waveIds[0])).comparison_status, 'BASELINE');
  let gate = await comparability(waveIds[1]);
  assert.equal(gate.comparison_status, 'NOT_COMPARABLE');
  hasReason(gate, 'Research design has not been declared');
  await declareDesign(waveIds);
  for (let index = 0; index < waveIds.length; index++) {
    await evidence(waveIds[index], 5, { strength: index + 2, positiveCount: index + 2, candidatePositiveCount: index + 1 });
  }
  gate = await comparability(waveIds[1]);
  assert.equal(gate.comparison_status, 'COMPARABLE');
  assert.equal(gate.previous_iteration_id, waveIds[0]);
  let row = await movement(waveIds[1]);
  assert.equal(row.comparison_basis, 'COMPARABLE');
  assert.equal(Number(row.party_strength_change), 1);
  assert.equal(Number(row.positive_sentiment_change_pct), 20);
  assert.equal(Number(row.candidate_positive_change_pct), 20);

  // The migrator replays 027 too; its earlier movement view must retain columns
  // added by the later comparability migrations before the final gate is reapplied.
  await db.exec(previousMovementSql);
  await db.exec(migrations[0]);
  await db.exec(migrations[1]);
  assert.deepEqual(await signature('analytics_iteration_comparability_v1'), columns[0]);
  assert.deepEqual(await signature('analytics_iteration_movement_v1'), columns[1]);
  assert.equal((await comparability(waveIds[1])).comparison_status, 'COMPARABLE', 'replay preserves declarations');

  // Every declared method dimension blocks movement when it changes.
  for (const [field, value, reason] of [
    ['target_population', 'All adults', 'Target population changed'],
    ['sample_frame_name', 'Phone directory', 'Sample frame changed'],
    ['sampling_method', 'PURPOSIVE', 'Sampling method changed'],
    ['selection_method', 'Panel', 'Respondent selection method changed'],
    ['weighting_status', 'PLANNED', 'Weighting approach changed'],
    ['weighting_method', 'Raking', 'Weighting approach changed'],
    ['weighting_variables', JSON.stringify(['gender']), 'Weighting variables changed'],
    ['fieldwork_mode', 'IN_PERSON', 'Fieldwork mode changed']
  ]) {
    await db.query(`UPDATE analytics_research_design_registry SET ${field} = $1 WHERE iteration_id = $2`, [value, waveIds[1]]);
    gate = await comparability(waveIds[1]);
    assert.equal(gate.comparison_status, 'NOT_COMPARABLE', field);
    hasReason(gate, reason);
    noMovement(await movement(waveIds[1]), field);
    await declareDesign([waveIds[1]]);
  }
  for (const id of [waveIds[0], waveIds[1]]) {
    await db.query('UPDATE analytics_research_design_registry SET declared_at = NULL WHERE iteration_id = $1', [id]);
    assert.equal((await comparability(waveIds[1])).comparison_status, 'NOT_COMPARABLE');
    noMovement(await movement(waveIds[1]), 'missing declared method');
    await declareDesign([id]);
  }

  // A live questionnaire ID never substitutes for missing frozen provenance.
  for (const snapshot of [null, {}, [], { code: 'SURVEY-1' }, { code: ' ', version: 1 }, { code: 'SURVEY-1', version: ' ' }]) {
    for (const id of [waveIds[0], waveIds[1]]) {
      await db.query('UPDATE program_iterations SET questionnaire_snapshot = $1::jsonb WHERE id = $2', [snapshot === null ? null : JSON.stringify(snapshot), id]);
      gate = await comparability(waveIds[1]);
      assert.equal(gate.comparison_status, 'NOT_COMPARABLE');
      hasReason(gate, 'frozen questionnaire identity is missing');
      noMovement(await movement(waveIds[1]), 'missing frozen provenance');
      await db.query('UPDATE program_iterations SET questionnaire_snapshot = $1::jsonb WHERE id = $2', [JSON.stringify(frozenQuestionnaire), id]);
    }
  }
  await db.query('UPDATE program_iterations SET questionnaire_id = NULL WHERE id = $1', [waveIds[1]]);
  assert.equal((await comparability(waveIds[1])).comparison_status, 'NOT_COMPARABLE');
  await db.query('UPDATE program_iterations SET questionnaire_id = $1 WHERE id = $2', [uuid(9999), waveIds[1]]);
  gate = await comparability(waveIds[1]);
  assert.equal(gate.comparison_status, 'NOT_COMPARABLE', 'changing the live ID while leaving the frozen snapshot untouched is not comparable');
  hasReason(gate, 'Questionnaire identity changed');
  noMovement(await movement(waveIds[1]), 'live identity drift');
  await db.query('UPDATE program_iterations SET questionnaire_id = $1, questionnaire_snapshot = $2::jsonb WHERE id = $3',
    [questionnaireId, JSON.stringify({ ...frozenQuestionnaire, id: uuid(9999) }), waveIds[1]]);
  gate = await comparability(waveIds[1]);
  assert.equal(gate.comparison_status, 'NOT_COMPARABLE', 'a frozen ID must match its retained live ID');
  hasReason(gate, 'identity is missing or inconsistent');
  await db.query('UPDATE program_iterations SET questionnaire_id = $1, questionnaire_snapshot = $2::jsonb WHERE id = $3',
    [questionnaireId, JSON.stringify({ ...frozenQuestionnaire, version: 2 }), waveIds[1]]);
  gate = await comparability(waveIds[1]);
  assert.equal(gate.comparison_status, 'NOT_COMPARABLE');
  hasReason(gate, 'Questionnaire identity changed');
  await db.query('UPDATE program_iterations SET questionnaire_snapshot = $1::jsonb WHERE id = $2', [JSON.stringify(frozenQuestionnaire), waveIds[1]]);

  const gapIds = await addCampaign(uuid(2), [1, 3]);
  await declareDesign(gapIds);
  for (const id of gapIds) await evidence(id, 5);
  gate = await comparability(gapIds[1]);
  assert.equal(gate.previous_iteration_id, gapIds[0]);
  assert.equal(gate.comparison_status, 'NOT_COMPARABLE');
  hasReason(gate, 'Iteration numbers are not consecutive');
  noMovement(await movement(gapIds[1]), 'skipped iteration number');

  const missingIds = await addCampaign(uuid(3), [1, 2, 3]);
  await declareDesign(missingIds);
  await evidence(missingIds[0], 5, { strength: 2 });
  await evidence(missingIds[2], 5, { strength: 5 });
  assert.equal((await comparability(missingIds[2])).comparison_status, 'COMPARABLE', 'method gate may pass without evidence');
  row = await movement(missingIds[2]);
  assert.equal(row.comparison_basis, 'NOT_COMPARABLE');
  hasReason(row, 'missing waves are not bridged');
  noMovement(row, 'intervening iteration has no evidence');

  for (const bases of [[4, 5], [5, 4]]) {
    const ids = await addCampaign(uuid(bases[0] === 4 ? 4 : 5), [1, 2]);
    await declareDesign(ids);
    await evidence(ids[0], bases[0], { strength: 2 });
    await evidence(ids[1], bases[1], { strength: 4 });
    row = await movement(ids[1]);
    assert.equal(row.comparison_basis, 'SUPPRESSED');
    hasReason(row, 'Fewer than five respondents');
    noMovement(row, 'respondent base below five');
    if (bases[1] < 5) {
      for (const field of ['average_direct_party_strength', 'positive_sentiment_pct', 'negative_sentiment_pct', 'candidate_positive_pct']) assert.equal(row[field], null, field);
    }
  }
  const smallMiddleIds = await addCampaign(uuid(9), [1, 2, 3]);
  await declareDesign(smallMiddleIds);
  for (let index = 0; index < smallMiddleIds.length; index++) await evidence(smallMiddleIds[index], index === 1 ? 4 : 5, { strength: index + 2 });
  row = await movement(smallMiddleIds[2]);
  assert.equal(row.comparison_basis, 'SUPPRESSED', 'a small middle wave is not skipped to compare waves one and three');
  noMovement(row, 'middle wave has fewer than five respondents');
  for (const directBases of [[4, 5], [5, 4]]) {
    const ids = await addCampaign(uuid(directBases[0] === 4 ? 6 : 7), [1, 2]);
    await declareDesign(ids);
    await evidence(ids[0], 5, { strength: 2, directBase: directBases[0] });
    await evidence(ids[1], 5, { strength: 4, directBase: directBases[1] });
    row = await movement(ids[1]);
    assert.equal(row.comparison_basis, 'COMPARABLE');
    assert.equal(row.party_strength_change, null, 'direct movement needs five answers in both waves');
    hasReason(row, 'five answered direct measures');
    assert.notEqual(row.positive_sentiment_change_pct, null, 'respondent movement retains its valid base');
    if (directBases[1] < 5) assert.equal(row.average_direct_party_strength, null);
  }
  const archiveIds = await addCampaign(uuid(8), [1, 2], { status: 'ARCHIVED' });
  await declareDesign(archiveIds);
  assert.equal(await comparability(archiveIds[0]), undefined, 'archived campaign excluded');
  console.log('Shared comparison SQL tests passed: schema upgrade/replay, declared methods, frozen identity, consecutive waves, missing evidence and minimum bases.');
} catch (error) {
  console.error('Shared comparison SQL tests failed:', error.code ? `${error.code}: ${error.message}` : error.stack);
  process.exitCode = 1;
} finally {
  await db.close();
}
