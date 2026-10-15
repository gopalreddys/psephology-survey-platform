// Isolated PostgreSQL regression: no production RDS, AWS or Sarvam access.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { canonical } from './research-report.js';
import { buildNormalizationSqlFunction, normalizeOutputValue } from '../output-variable-standardization/output-normalization.repository.js';

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
  .replace(/import \{ resolveResearchScope \} from '[^']+';/, "const resolveResearchScope = () => { throw new Error('Tests must inject an authorized scope'); };")
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
  // Execute the same generated SQL normalizer used by Quick, not a test rewrite.
  await db.exec(buildNormalizationSqlFunction());
  for (const key of ['leader_assessment', 'leader_sentiment', 'development_priority', 'expected_change']) {
    for (const value of [null, '', 'no answer', "can't say", 'refused', {},
      'good', 'bad', 'average', 'mixed', 'బాగుంది', 'సంతృప్తి లేదు', 'अच्छा नहीं',
      'jobs', 'education', 'water', 'skills', 'KCR', 'BRS', 'unrecognized wording']) {
      const canonicalKey = `\t${key.toUpperCase()}\u00a0`;
      const sqlResult = await db.query('SELECT analytics_normalize_output_v1($1, $2::jsonb) AS result', [canonicalKey, JSON.stringify(value)]);
      assert.deepEqual(sqlResult.rows[0].result, normalizeOutputValue(canonicalKey, value), `${key}: SQL and JavaScript must share the identical taxonomy`);
    }
  }
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
  assert.equal(get(report).answerBase, null, 'Missing-category complements and their denominators are withheld together');
  assert.equal(get(report).captureStatus, 'SMALL_CELLS_WITHHELD');
  assert.deepEqual(get(report).distribution, []);
  assert.equal(report.sources.latestEvidenceAt, '2026-10-11T12:00:00.000Z');
  // Demographic/geography filters match the native insight scope, not Run.
  await db.query("UPDATE voter_master SET mandal_name_source = 'Another Mandal' WHERE id = $1", [uid(109)]);
  const filtered = analysis(); filtered.segment.respondentBase = 9;
  report = await loadResearchReport(campaignId, {}, {}, { analyze: async () => filtered, getDb: async () => db });
  assert.equal(get(report).respondentBase, null);
  assert.equal(get(report).answerBase, null);
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
  // A separate future instrument exercises all three newly surfaced report
  // constructs. Its leader target and exact keys must not borrow a party name,
  // another assessment, a sibling alias, a different Iteration or an older call.
  const futureCampaign = uid(1000), futureIteration = uid(1001), futureQuestionnaire = uid(1002), otherIteration = uid(1003);
  const leader = { type: 'LEADER', id: 'public_leader_1', name: 'Named public leader' };
  const constructs = [
    { id: 'development_priority', key: 'development_priority', values: ['jobs', 'education'], labels: ['Employment and jobs', 'Education and universities'], target: { type: 'NONE', id: '', name: '' } },
    { id: 'expected_change', key: 'expected_change', values: ['water', 'skills'], labels: ['Civic services and infrastructure', 'Skills and professional development'], target: { type: 'NONE', id: '', name: '' } },
    { id: 'leader_assessment', key: 'leader_sentiment', values: ['good', 'bad'], labels: ['Positive', 'Negative'], target: leader }
  ];
  const futureQuestions = constructs.map((item, index) => ({ question_order: index + 1, question_code: `Q_NEW_${index + 1}`,
    question_text: `Neutral dedicated research question ${index + 1}?`, metadata: { output_variables: [item.key],
      reporting_contract: { reportKey: item.id, outputVariables: [item.key], valueType: 'CATEGORICAL',
        allowedValues: item.labels, target: item.target, missingPolicy: 'EXPLICIT_STATES' } } }));
  const futureSnapshot = { id: futureQuestionnaire, code: 'FUTURE_RESEARCH_1', version: 1, snapshot_schema_version: 2,
    question_provenance: 'FROZEN_AT_SELECTION', questions: futureQuestions,
    content_fingerprint: createHash('sha256').update(JSON.stringify(canonical(futureQuestions))).digest('hex') };
  await db.query("INSERT INTO campaigns VALUES ($1,'ACTIVE')", [futureCampaign]);
  await db.query('INSERT INTO program_iterations VALUES ($1,$2,$3::jsonb,NULL),($4,$2,$3::jsonb,NULL)', [futureIteration, futureQuestionnaire, JSON.stringify(futureSnapshot), otherIteration]);
  await db.query('INSERT INTO campaign_iteration_links VALUES ($1,$2),($1,$3)', [futureCampaign, futureIteration, otherIteration]);
  const futureAnalysis = () => ({ ...analysis(), campaign: { id: futureCampaign, code: 'FUTURE', name: 'Future research', status: 'ACTIVE' },
    scope: { ...analysis().scope, iteration: { id: futureIteration, number: 1, name: 'Future Iteration', completed: true },
      insightScope: { iterationId: futureIteration, filters: { gender: 'Female', ageBand: '30–39', mandal: 'Serilingampally' } } },
    segment: { respondentBase: 10, suppressed: false } });
  const futureLoad = () => loadResearchReport(futureCampaign, { role_code: 'ADMIN' }, {}, { analyze: async () => futureAnalysis(), getDb: async () => db });
  const futureGet = (result, key) => result.reports.find((entry) => entry.id === key);
  function futureValues(index) {
    const values = Object.fromEntries(constructs.map((item) => [item.key, item.values[index < 5 ? 0 : 1]]));
    if (index === 0) { values['\tLEADER_SENTIMENT\u00a0'] = values.leader_sentiment; delete values.leader_sentiment; }
    return { ...values, priority_development: 'representation', desired_change: 'jobs', leader_assessment: 'mixed',
      graduate_issue_priority: 'representation', incumbent_assessment: 'neutral', candidate_impression: 'mixed',
      party_salience_unaided: 'Congress', perceived_issue_leader_aided: 'KCR',
      voter_name: 'NEVER_EXPORT_NEW_REPORT_NAME', phone_number: '9999999999' };
  }
  for (let index = 0; index < 25; index++) {
    const gender = index >= 10 && index < 15 ? 'male' : 'female';
    const age = index >= 15 && index < 20 ? 25 : 35;
    const mandal = index >= 20 ? 'Another Mandal' : 'Serilingampally';
    await db.query('INSERT INTO voter_master VALUES ($1,$2,$3,$4)', [uid(1100 + index), gender, age, mandal]);
    // Old eligible answers and the same voters in another Iteration carry
    // different values. Neither may enter the future instrument's latest scope.
    await db.query("INSERT INTO calls (id,iteration_id,voter_id,connectivity_status,response_variables,updated_at,first_seen_at) VALUES ($1,$2,$3,'connected',$4::jsonb,'2026-10-08T10:00:00Z','2026-10-08T09:00:00Z')",
      [uid(1200 + index), futureIteration, uid(1100 + index), JSON.stringify({ development_priority: 'roads', expected_change: 'jobs', leader_sentiment: 'mixed' })]);
    await db.query("INSERT INTO calls (id,iteration_id,voter_id,connectivity_status,response_variables,updated_at,first_seen_at) VALUES ($1,$2,$3,'connected',$4::jsonb,'2026-10-10T10:00:00Z','2026-10-10T09:00:00Z')",
      [uid(1300 + index), futureIteration, uid(1100 + index), JSON.stringify(futureValues(index))]);
    await db.query("INSERT INTO calls (id,iteration_id,voter_id,connectivity_status,response_variables,updated_at,first_seen_at) VALUES ($1,$2,$3,'connected',$4::jsonb,'2026-10-12T10:00:00Z','2026-10-12T09:00:00Z')",
      [uid(1400 + index), otherIteration, uid(1100 + index), JSON.stringify({ development_priority: 'roads', expected_change: 'jobs', leader_sentiment: 'mixed' })]);
  }
  report = await futureLoad();
  for (const item of constructs) {
    const result = futureGet(report, item.id);
    assert.equal(result.captureStatus, 'DESCRIPTIVE_AVAILABLE', `${item.id}: exact filtered current instrument distribution`);
    assert.equal(result.answerBase, 10);
    assert.equal(result.codedBase, 10);
    assert.deepEqual(new Set(result.distribution.map((row) => row.value)), new Set(item.labels));
    assert.ok(result.distribution.every((row) => row.respondents === 5 && row.percentage === 50));
    assert.deepEqual(result.outputVariables, [item.key]);
  }
  assert.deepEqual(futureGet(report, 'leader_assessment').target, leader);
  assert.equal(report.sources.latestEvidenceAt, '2026-10-10T10:00:00.000Z');
  assert.ok(!JSON.stringify(report).includes('NEVER_EXPORT_NEW_REPORT_NAME'));
  assert.ok(!JSON.stringify(report).includes('9999999999'));
  // Later disconnected or empty rows do not erase eligible evidence.
  for (const [id, status, variables] of [[1500, 'disconnected', { development_priority: 'roads', expected_change: 'jobs', leader_sentiment: 'mixed' }], [1501, 'connected', {}]]) {
    await db.query("INSERT INTO calls (id,iteration_id,voter_id,connectivity_status,response_variables,updated_at,first_seen_at) VALUES ($1,$2,$3,$4,$5::jsonb,'2026-10-13T10:00:00Z','2026-10-13T09:00:00Z')",
      [uid(id), futureIteration, uid(1100), status, JSON.stringify(variables)]);
  }
  report = await futureLoad();
  for (const item of constructs) assert.equal(futureGet(report, item.id).captureStatus, 'DESCRIPTIVE_AVAILABLE');
  // A latest nonempty row with only other aliases cannot revive older exact
  // answers. Its one-person missing complement suppresses the whole partition.
  await db.query("INSERT INTO calls (id,iteration_id,voter_id,connectivity_status,response_variables,updated_at,first_seen_at) VALUES ($1,$2,$3,'connected',$4::jsonb,'2026-10-14T10:00:00Z','2026-10-14T09:00:00Z')",
    [uid(1502), futureIteration, uid(1100), JSON.stringify({ priority_development: 'jobs', desired_change: 'water', leader_assessment: 'good', incumbent_assessment: 'good' })]);
  report = await futureLoad();
  for (const item of constructs) {
    const result = futureGet(report, item.id);
    assert.equal(result.captureStatus, 'SMALL_CELLS_WITHHELD');
    for (const key of ['answerBase', 'codedBase', 'respondentBase']) assert.equal(result[key], null);
    assert.deepEqual(result.distribution, []);
  }
  assert.equal(report.sources.latestEvidenceAt, '2026-10-14T10:00:00.000Z');
  console.log('PostgreSQL research report exact-key projection, three dedicated constructs, normalization parity, deduplication, missingness, filters, source freshness and schema fallback tests passed.');
} finally {
  await db.close();
}
