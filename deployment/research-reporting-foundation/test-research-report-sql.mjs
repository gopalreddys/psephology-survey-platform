// Isolated PostgreSQL regression: no production RDS, AWS or Sarvam access.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { canonical } from './research-report.js';

const { PGlite } = await import(process.env.PGLITE_MODULE_PATH
  ? pathToFileURL(process.env.PGLITE_MODULE_PATH).href : '@electric-sql/pglite');
const db = new PGlite();
const uid = (number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const campaignId = uid(1), iterationId = uid(2), questionnaireId = uid(3);
const questions = [{ question_order: 1, question_code: 'Q_PARTY_ATTENTION', question_text: 'Which party comes to mind on local issues?',
  metadata: { output_variables: ['party_salience_unaided'], reporting_contract: { reportKey: 'party_salience',
    outputVariables: ['party_salience_unaided'], valueType: 'CATEGORICAL', allowedValues: ['BRS', 'BJP', 'Congress'],
    target: { type: 'NONE', id: '', name: '' }, missingPolicy: 'EXPLICIT_STATES' } } }];
const snapshot = { id: questionnaireId, code: 'SURVEY_1', version: 1, snapshot_schema_version: 2,
  question_provenance: 'FROZEN_AT_SELECTION', questions,
  content_fingerprint: createHash('sha256').update(JSON.stringify(canonical(questions))).digest('hex') };
let source = await readFile(new URL('./research-report.repository.js', import.meta.url), 'utf8');
source = source.replace(/import \{ getDb \} from '[^']+';/, "const getDb = () => { throw new Error('Production DB forbidden'); };")
  .replace(/import \{ getCampaignStrategicAnalytics \} from '[^']+';/, "const getCampaignStrategicAnalytics = () => { throw new Error('Production analysis forbidden'); };")
  .replace("'./research-report.js'", JSON.stringify(new URL('./research-report.js', import.meta.url).href))
  .replace("'./report-catalog.js'", JSON.stringify(new URL('./report-catalog.js', import.meta.url).href))
  .replace("'./fieldwork-diagnostics.repository.js'", JSON.stringify(new URL('./fieldwork-diagnostics.repository.js', import.meta.url).href))
  .replace("'./fieldwork-diagnostics.js'", JSON.stringify(new URL('./fieldwork-diagnostics.js', import.meta.url).href))
  .replace("'./output-normalization.repository.js'", JSON.stringify(new URL('../output-variable-standardization/output-normalization.repository.js', import.meta.url).href));
const { loadResearchReport } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const analysis = () => ({ campaign: { id: campaignId, code: 'C2', name: 'Second campaign', status: 'ACTIVE' },
  scope: { level: 'RUN', iteration: { id: iterationId, number: 1, name: 'Iteration 1', completed: false }, run: { id: uid(4), number: 3, status: 'RUNNING' },
    insightScope: { iterationId, filters: { gender: 'Female', ageBand: '30–39', mandal: 'Serilingampally' } } },
  segment: { respondentBase: 10, suppressed: false }, normalizationVersion: 'OUTPUT_TAXONOMY_V2', generatedAt: '2026-10-11T13:00:00Z' });
const load = () => loadResearchReport(campaignId, { role_code: 'ADMIN' }, {}, { analyze: async () => analysis(), getDb: async () => db });
const get = (report) => report.reports.find((item) => item.id === 'party_salience');

try {
  await db.exec(`
    CREATE TABLE campaigns (id uuid PRIMARY KEY, status text);
    CREATE TABLE program_iterations (id uuid PRIMARY KEY, questionnaire_id uuid, questionnaire_snapshot jsonb, voice_agent_snapshot jsonb);
    CREATE TABLE campaign_iteration_links (campaign_id uuid, iteration_id uuid);
    CREATE TABLE voter_master (id uuid PRIMARY KEY, gender text, age integer, mandal_name_source text);
    CREATE TABLE calls (id uuid PRIMARY KEY, iteration_id uuid, voter_id uuid, connectivity_status text,
      response_variables jsonb, updated_at timestamptz, first_seen_at timestamptz);
    CREATE TABLE analytics_research_design_registry_v2 (iteration_id uuid, campaign_id uuid,
      design_declared boolean, revision integer, declared_at timestamptz, fieldwork_mode text,
      sampling_method text, cohort_design text, weighting_status text, comparison_status text);
  `);
  await db.query("INSERT INTO campaigns VALUES ($1, 'ACTIVE')", [campaignId]);
  await db.query('INSERT INTO program_iterations VALUES ($1, $2, $3::jsonb, $4::jsonb)', [iterationId, questionnaireId, JSON.stringify(snapshot), JSON.stringify({ catalog_id: uid(5), app_id: 'APP_1', app_version: 5, outbound_phone_number: '9999999999' })]);
  await db.query('INSERT INTO campaign_iteration_links VALUES ($1, $2)', [campaignId, iterationId]);
  for (let index = 0; index < 10; index++) {
    await db.query("INSERT INTO voter_master VALUES ($1, 'female', 35, 'Serilingampally')", [uid(100 + index)]);
    await db.query("INSERT INTO calls VALUES ($1, $2, $3, 'connected', $4::jsonb, '2026-10-09T10:00:00Z', '2026-10-09T09:00:00Z')",
      [uid(200 + index), iterationId, uid(100 + index), JSON.stringify({ party_salience_unaided: 'Congress' })]);
    await db.query("INSERT INTO calls VALUES ($1, $2, $3, 'connected', $4::jsonb, '2026-10-10T10:00:00Z', '2026-10-10T09:00:00Z')",
      [uid(300 + index), iterationId, uid(100 + index), JSON.stringify({ party_salience_unaided: index < 5 ? 'BRS' : 'BJP', party_preference: 'Congress', voter_name: 'NEVER_EXPORT_NAME', phone_number: '9999999999' })]);
  }
  let report = await load();
  assert.equal(report.schemaVersion, 2);
  assert.equal(report.rulesVersion, 'RESEARCH_REPORT_V2');
  assert.equal(report.fieldworkDiagnostics.status, 'NOT_AVAILABLE', 'Old schemas cannot invent a selected contact cohort');
  assert.equal(report.fieldworkDiagnostics.coverage.selectedBase, null);
  assert.equal(get(report).captureStatus, 'DESCRIPTIVE_AVAILABLE');
  assert.equal(get(report).answerBase, 10);
  assert.deepEqual(get(report).distribution.map((row) => [row.value, row.respondents]), [['BJP', 5], ['BRS', 5]], 'Latest eligible response and exact frozen key, not native alias pool');
  assert.equal(report.scope.iterationNumber, 1);
  assert.equal(report.scope.run.number, 3);
  assert.equal(report.scope.fieldworkStatus, 'IN_PROGRESS');
  assert.equal(report.sources.latestEvidenceAt, '2026-10-10T10:00:00.000Z');
  assert.equal(report.methodology.declarationStatus, 'NOT_DECLARED');
  assert.ok(!JSON.stringify(report).includes('NEVER_EXPORT_NAME'));
  assert.ok(!JSON.stringify(report).includes('9999999999'));
  // Install an isolated retained contact/execution schema after verifying the
  // old-schema fallback. Retried contacts do not inflate the Run 1 cohort.
  await db.exec(`
    CREATE TABLE campaign_runs (id uuid PRIMARY KEY, iteration_id uuid, run_number integer,
      created_at timestamptz, updated_at timestamptz);
    CREATE TABLE campaign_run_contacts (id uuid PRIMARY KEY, run_id uuid, voter_id uuid,
      attempt_status text, attempt_count integer);
    CREATE TABLE call_executions (id uuid PRIMARY KEY, run_contact_id uuid, run_id uuid, voter_id uuid,
      status text, provider_attempt_id text, callback_received_at timestamptz,
      created_at timestamptz, updated_at timestamptz);
    ALTER TABLE calls ADD COLUMN run_id uuid, ADD COLUMN attempt_id text;
  `);
  await db.query("INSERT INTO campaign_runs VALUES ($1,$2,1,'2026-10-09T09:00:00Z','2026-10-09T10:00:00Z'),($3,$2,3,'2026-10-10T09:00:00Z','2026-10-10T10:00:00Z')", [uid(6), iterationId, uid(4)]);
  for (let index = 0; index < 10; index++) {
    await db.query("INSERT INTO campaign_run_contacts VALUES ($1,$2,$3,'FAILED',1),($4,$5,$3,'COMPLETED',1)",
      [uid(500 + index), uid(6), uid(100 + index), uid(600 + index), uid(4)]);
    await db.query("INSERT INTO call_executions VALUES ($1,$2,$3,$4,'COMPLETED',$5,'2026-10-10T10:00:00Z','2026-10-10T09:00:00Z','2026-10-10T10:00:00Z')",
      [uid(700 + index), uid(600 + index), uid(4), uid(100 + index), `ATTEMPT_${index}`]);
    await db.query('UPDATE calls SET run_id=$2,attempt_id=$3 WHERE id=$1', [uid(300 + index), uid(4), `ATTEMPT_${index}`]);
  }
  report = await load();
  assert.equal(report.fieldworkDiagnostics.status, 'IN_PROGRESS');
  assert.equal(report.fieldworkDiagnostics.coverage.selectedBase, 10);
  assert.deepEqual(report.fieldworkDiagnostics.coverage.stages.map((stage) => stage.participants), [10, 10, 10, 10]);
  assert.equal(report.fieldworkDiagnostics.sources.analysisBaseAlignment, 'MATCHED');
  assert.equal(report.fieldworkDiagnostics.sources.eligibleFrame, 'NOT_RECORDED');
  assert.equal(report.fieldworkDiagnostics.sources.probabilitySampling, 'NOT_VERIFIED');
  assert.equal(report.fieldworkDiagnostics.sources.surveyCompletion, 'UNAVAILABLE');
  assert.equal(report.fieldworkDiagnostics.sources.standardizedResponseRate, 'UNAVAILABLE');
  assert.equal(report.fieldworkDiagnostics.coverage.yield.percentage, 100);
  assert.equal(get(report).answerBase, 10, 'Operational diagnostics do not change exact-key answer calculations');
  // A later empty/disconnected attempt never erases an eligible response.
  await db.query("INSERT INTO calls VALUES ($1, $2, $3, 'connected', '{}'::jsonb, '2026-10-11T10:00:00Z', '2026-10-11T09:00:00Z')", [uid(400), iterationId, uid(100)]);
  await db.query("INSERT INTO calls VALUES ($1, $2, $3, 'disconnected', $4::jsonb, '2026-10-11T11:00:00Z', '2026-10-11T10:00:00Z')", [uid(401), iterationId, uid(101), JSON.stringify({ party_salience_unaided: 'Congress' })]);
  report = await load();
  assert.equal(get(report).answerBase, 10);
  assert.equal(report.sources.latestEvidenceAt, '2026-10-10T10:00:00.000Z');
  // A latest nonempty response that lacks this exact key must stay missing.
  // It cannot revive an older answer or substitute party_preference.
  await db.query("INSERT INTO calls VALUES ($1, $2, $3, 'connected', $4::jsonb, '2026-10-11T12:00:00Z', '2026-10-11T11:00:00Z')", [uid(402), iterationId, uid(100), JSON.stringify({ party_preference: 'Congress', another_construct: 'jobs' })]);
  report = await load();
  assert.equal(get(report).answerBase, 9);
  assert.equal(get(report).captureStatus, 'SMALL_CELLS_WITHHELD');
  assert.deepEqual(get(report).distribution, []);
  assert.equal(report.sources.latestEvidenceAt, '2026-10-11T12:00:00.000Z');
  // Demographic/geography filters match the native insight scope, not Run.
  await db.query("UPDATE voter_master SET mandal_name_source = 'Another Mandal' WHERE id = $1", [uid(109)]);
  const filtered = analysis(); filtered.segment.respondentBase = 9;
  report = await loadResearchReport(campaignId, {}, {}, { analyze: async () => filtered, getDb: async () => db });
  assert.equal(get(report).respondentBase, 9);
  assert.equal(get(report).answerBase, 8);
  assert.deepEqual(report.scope.filters, filtered.scope.insightScope.filters);
  // Missing old registry relation must not be a successful declaration.
  await db.exec('DROP TABLE analytics_research_design_registry_v2');
  report = await loadResearchReport(campaignId, {}, {}, { analyze: async () => filtered, getDb: async () => db });
  assert.equal(report.methodology.declarationStatus, 'NOT_DECLARED');
  // A retained contact added only to a later Run cannot silently enlarge the
  // initial cohort. The artifact requests reconciliation instead.
  await db.query("INSERT INTO voter_master VALUES ($1,'female',35,'Serilingampally')", [uid(900)]);
  await db.query("INSERT INTO campaign_run_contacts VALUES ($1,$2,$3,'PENDING',0)", [uid(901), uid(4), uid(900)]);
  report = await loadResearchReport(campaignId, {}, {}, { analyze: async () => filtered, getDb: async () => db });
  assert.equal(report.fieldworkDiagnostics.coverage.selectedBase, 9);
  assert.equal(report.fieldworkDiagnostics.sources.outsideInitialCohort, 'OBSERVED');
  assert.equal(report.checks.find((check) => check.id === 'fieldwork-analysis-alignment').status, 'REVIEW_REQUIRED');
  assert.ok(report.nextActions.some((action) => /Reconcile Run 1 cohort membership/.test(action)));
  const mismatched = { ...filtered, segment: { respondentBase: 8, suppressed: false } };
  report = await loadResearchReport(campaignId, {}, {}, { analyze: async () => mismatched, getDb: async () => db });
  assert.equal(report.fieldworkDiagnostics.sources.analysisBaseAlignment, 'MISMATCH');
  assert.equal(report.checks.find((check) => check.id === 'fieldwork-analysis-alignment').status, 'REVIEW_REQUIRED');
  console.log('PostgreSQL research report exact-key projection, deduplication, missingness, filters, source freshness and schema fallback tests passed.');
} finally {
  await db.close();
}
