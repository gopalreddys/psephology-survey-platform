import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { ResearchDesignError, validateResearchDesign, permittedSamplingMethods } from './research-methodology-validation.js';
import { campaignReviewVisibilitySql } from '../campaign-draft-privacy/campaign-visibility.repository.js';
import { buildQuestionnaireContentSnapshot } from './questionnaire-snapshot.repository.js';
import { getSentimentValidation } from '../output-variable-standardization/output-normalization.repository.js';

const actual = {
  targetPopulation: 'Consented demo participants, not the general electorate',
  sampleFrameName: 'Approved demo contact register, 2026-10-08',
  samplingMethod: 'CENSUS', selectionMethod: 'Invite every approved contact; retry unanswered calls',
  cohortDesign: 'SAME_PARTICIPANTS', weightingStatus: 'NOT_REQUIRED',
  weightingMethod: '', weightingVariables: [], fieldworkMode: 'AI_ASSISTED_OUTBOUND_VOICE',
  methodologyNotes: 'Demo convenience frame; non-response may affect aggregate findings',
  changeReason: 'Confirmed actual fieldwork from execution register', attested: true, expectedRevision: 0
};
assert.equal(validateResearchDesign(actual).targetPopulation, actual.targetPopulation);
for (const field of ['targetPopulation', 'sampleFrameName', 'selectionMethod', 'cohortDesign', 'samplingMethod', 'fieldworkMode', 'changeReason']) {
  for (const value of [null, '', '  ', 'Not declared', 'N/A', {}, ['unexpected']]) {
    assert.throws(() => validateResearchDesign({ ...actual, [field]: value }), ResearchDesignError, `${field}=${JSON.stringify(value)}`);
  }
}
for (const body of [
  { ...actual, attested: false }, { ...actual, attested: 'true' },
  { ...actual, expectedRevision: undefined }, { ...actual, expectedRevision: '0' },
  { ...actual, expectedRevision: -1 }, { ...actual, expectedRevision: 0.5 },
  { ...actual, fieldworkMode: 'WEB_UNKNOWN' }, { ...actual, cohortDesign: 'NOT_DECLARED' },
  { ...actual, weightingStatus: 'NOT_CONFIGURED' }, { ...actual, weightingStatus: 'APPLIED' },
  { ...actual, weightingStatus: 'PLANNED' }, { ...actual, weightingStatus: 'PLANNED', weightingMethod: 'Raking' },
  { ...actual, weightingVariables: 'age' }, { ...actual, weightingVariables: [false] },
  { ...actual, weightingVariables: [''] }, { ...actual, weightingVariables: Array(21).fill('age') },
  { ...actual, targetPopulation: 'x'.repeat(501) }, { ...actual, methodologyNotes: {} },
  { ...actual, weightingMethod: 'Inconsistent unweighted method' }
]) assert.throws(() => validateResearchDesign(body), ResearchDesignError);
assert.deepEqual(validateResearchDesign({ ...actual, weightingStatus: 'PLANNED', weightingMethod: 'Raking', weightingVariables: ['age', ' age '] }).weightingVariables, ['age']);

// Execute the installed-layout module with its real validation and visibility
// dependencies. Only imports are injected; production SQL and transactions run.
const source = await readFile(new URL('./research-methodology.repository.js', import.meta.url), 'utf8');
globalThis.__methodologyTestBindings = { campaignReviewVisibilitySql, ResearchDesignError, validateResearchDesign, permittedSamplingMethods };
const executable = 'const { campaignReviewVisibilitySql, ResearchDesignError, validateResearchDesign, permittedSamplingMethods } = globalThis.__methodologyTestBindings;\n'
  + source.replace(/^import .*;\n/gm, '').replace(/^export \{.*\} from .*;\n/gm, '');
const { saveResearchDesign, researchDesignHistory } = await import(`data:text/javascript;base64,${Buffer.from(executable).toString('base64')}`);
delete globalThis.__methodologyTestBindings;

const modulePath = process.env.PGLITE_MODULE_PATH;
const { PGlite } = await import(modulePath ? pathToFileURL(path.resolve(modulePath)).href : '@electric-sql/pglite');
const db = new PGlite();
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const superAdmin = { id: uuid(1), role_code: 'SUPER_ADMIN' };
const ownerAdmin = { id: uuid(1), role_code: 'ADMIN' };
const otherAdmin = { id: uuid(2), role_code: 'ADMIN' };
const campaignId = uuid(10), iterationId = uuid(20), questionnaireId = uuid(30);
let releases = 0, failAudit = false;
const adapter = {
  query: (...args) => db.query(...args),
  connect: async () => ({
    query: (...args) => {
      if (failAudit && args[0].includes('INSERT INTO analytics_research_design_audit')) throw new Error('simulated audit failure');
      return db.query(...args);
    },
    release: () => { releases++; }
  })
};
try {
  await db.exec(`
    CREATE TABLE users(id uuid PRIMARY KEY);
    CREATE TABLE campaigns(id uuid PRIMARY KEY, campaign_code text, campaign_name text, status text,
      campaign_manager_user_id uuid, created_by_user_id uuid);
    CREATE TABLE program_iterations(id uuid PRIMARY KEY, iteration_number int, iteration_name text,
      questionnaire_id uuid, questionnaire_snapshot jsonb, created_at timestamptz, sample_design_type text);
    CREATE TABLE campaign_iteration_links(campaign_id uuid, iteration_id uuid UNIQUE, created_at timestamptz);
    CREATE TABLE analytics_research_enterprise_v1(program_id uuid, program_code text, program_name text,
      campaign_id uuid, campaign_code text, campaign_name text, iteration_id uuid, iteration_number int,
      iteration_name text, respondent_key text, direct_party_strength numeric, respondent_sentiment text,
      candidate_sentiment text, issue_priority text);
  `);
  await db.query('INSERT INTO users VALUES($1),($2)', [superAdmin.id, otherAdmin.id]);
  await db.query("INSERT INTO campaigns VALUES($1,'C1','Campaign','COMPLETED',NULL,$2)", [campaignId, superAdmin.id]);
  const snapshot = buildQuestionnaireContentSnapshot({ id: questionnaireId, questionnaire_code: 'SURVEY', questionnaire_name: 'Survey', version_number: 1, status: 'ACTIVE' }, [{ question_code: 'Q1', question_order: 1, question_text: 'Which issue matters most?', question_type: 'OPEN_TEXT', metadata: {} }]);
  await db.query("INSERT INTO program_iterations VALUES($1,1,'Iteration 1',$2,$3::jsonb,now(),'REPEATED_CROSS_SECTION')", [iterationId, questionnaireId, JSON.stringify(snapshot)]);
  await db.query('INSERT INTO campaign_iteration_links VALUES($1,$2,now())', [campaignId, iterationId]);
  for (const filename of ['028_research_design_comparability.sql', '029_shared_comparison_gate.sql', '031_audited_research_methodology.sql']) {
    await db.exec(await readFile(new URL(`../amazon-quick-enterprise-dashboard/${filename}`, import.meta.url), 'utf8'));
  }
  await assert.rejects(saveResearchDesign(adapter, { id: uuid(3), role_code: 'CAMPAIGN_MANAGER' }, iterationId, actual), { code: 'RESEARCH_DESIGN_FORBIDDEN' });
  await assert.rejects(saveResearchDesign(adapter, superAdmin, 'not-a-uuid', actual), { code: 'INVALID_ITERATION_ID' });
  await assert.rejects(saveResearchDesign(adapter, otherAdmin, iterationId, actual), { code: 'ITERATION_NOT_FOUND' });
  assert.equal((await db.query('SELECT count(*)::int n FROM analytics_research_design_audit')).rows[0].n, 0);

  const first = await saveResearchDesign(adapter, superAdmin, iterationId, { ...actual, declaredByUserId: otherAdmin.id });
  assert.equal(first.revision, 1);
  assert.equal(first.design_declared, true);
  assert.equal(first.question_content_recorded, true);
  assert.equal(first.declared_by_user_id, superAdmin.id, 'client cannot spoof the declaring actor');
  let history = await researchDesignHistory(adapter, superAdmin, iterationId);
  assert.equal(history.length, 1);
  assert.equal(history[0].design.attested, true);
  assert.equal(history[0].changeReason, actual.changeReason);
  await assert.rejects(researchDesignHistory(adapter, otherAdmin, iterationId), { code: 'ITERATION_NOT_FOUND' });
  await assert.rejects(saveResearchDesign(adapter, superAdmin, iterationId, actual), { code: 'RESEARCH_DESIGN_REVISION_CONFLICT', status: 409 });

  failAudit = true;
  await assert.rejects(saveResearchDesign(adapter, superAdmin, iterationId, { ...actual, expectedRevision: 1, targetPopulation: 'Changed' }), /simulated audit failure/);
  failAudit = false;
  assert.equal((await db.query('SELECT revision, target_population FROM analytics_research_design_registry')).rows[0].revision, 1);
  assert.equal((await db.query('SELECT target_population FROM analytics_research_design_registry')).rows[0].target_population, actual.targetPopulation, 'audit failure rolls back registry update');
  assert.equal((await researchDesignHistory(adapter, superAdmin, iterationId)).length, 1);

  await saveResearchDesign(adapter, ownerAdmin, iterationId, { ...actual, expectedRevision: 1, methodologyNotes: 'Updated source confirmation', changeReason: "Fieldwork team's verified register" });
  history = await researchDesignHistory(adapter, ownerAdmin, iterationId);
  assert.deepEqual(history.map((entry) => entry.revision), [2, 1]);
  assert.equal(history[1].design.methodology_notes, actual.methodologyNotes, 'earlier revision remains intact');
  await db.query('UPDATE campaigns SET campaign_manager_user_id=$1 WHERE id=$2', [uuid(9), campaignId]);
  assert.equal((await researchDesignHistory(adapter, otherAdmin, iterationId)).length, 2, 'assigned campaigns retain ordinary Admin review visibility');
  // Execute the real quality route SQL, not just a regex assertion: the same
  // draft privacy predicate must restrict quality, movement AND registry rows.
  const privateCampaign = uuid(11), privateIteration = uuid(21);
  await db.query("INSERT INTO campaigns VALUES($1,'C2','Other Admin private draft','DRAFT',NULL,$2)", [privateCampaign, otherAdmin.id]);
  await db.query("INSERT INTO program_iterations VALUES($1,1,'Private Iteration',$2,$3::jsonb,now(),'REPEATED_CROSS_SECTION')", [privateIteration, questionnaireId, JSON.stringify(snapshot)]);
  await db.query('INSERT INTO campaign_iteration_links VALUES($1,$2,now())', [privateCampaign, privateIteration]);
  await db.exec(`CREATE TABLE analytics_research_quality_v1(campaign_id uuid, campaign_name text, fieldwork_ended_at timestamptz);
    CREATE TABLE analytics_iteration_movement_v2(campaign_id uuid, campaign_name text, iteration_number int);`);
  for (const [id, name] of [[campaignId, 'Campaign'], [privateCampaign, 'Other Admin private draft']]) {
    await db.query('INSERT INTO analytics_research_quality_v1 VALUES($1,$2,now())', [id, name]);
    await db.query('INSERT INTO analytics_iteration_movement_v2 VALUES($1,$2,1)', [id, name]);
  }
  const routes = [];
  const capture = (method) => (route, ...handlers) => { routes.push({ method, route, handlers }); };
  const router = { get: capture('GET'), put: capture('PUT') };
  const requireRole = (roles) => Object.assign(() => {}, { roles });
  globalThis.__methodologyRouteBindings = {
    express: { Router: () => router }, requireAuth: () => {}, requireRole,
    getDb: async () => adapter, campaignReviewVisibilitySql, saveResearchDesign,
    researchDesignHistory, ResearchDesignError, getSentimentValidation
  };
  const routeSource = await readFile(new URL('../amazon-quick-enterprise-dashboard/amazon-quick-dashboard.routes.js', import.meta.url), 'utf8');
  const routeExecutable = 'const { express, requireAuth, requireRole, getDb, campaignReviewVisibilitySql, saveResearchDesign, researchDesignHistory, ResearchDesignError, getSentimentValidation } = globalThis.__methodologyRouteBindings;\n'
    + routeSource.replace(/^import .*;\n/gm, '');
  await import(`data:text/javascript;base64,${Buffer.from(routeExecutable).toString('base64')}`);
  delete globalThis.__methodologyRouteBindings;
  const qualityRoute = routes.find((route) => route.route === '/enterprise-dashboard/research-quality');
  assert.deepEqual(qualityRoute.handlers[1].roles, ['SUPER_ADMIN', 'ADMIN']);
  const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { return { status: this.statusCode, body }; } });
  const ownerQuality = await qualityRoute.handlers.at(-1)({ platformUser: ownerAdmin }, response());
  assert.equal(ownerQuality.status, 200, 'privacy-scoped production SQL remains valid');
  assert.equal(ownerQuality.body.sentimentValidation.status, 'HUMAN_REVIEW_PENDING');
  for (const key of ['campaigns', 'movement', 'researchDesigns']) {
    assert.equal(ownerQuality.body[key].length, 1, `${key} hides other Admin private drafts`);
  }
  assert.match(ownerQuality.body.methodology.weightingStatus, /unweighted/);
  const superQuality = await qualityRoute.handlers.at(-1)({ platformUser: superAdmin }, response());
  assert.equal(superQuality.status, 200);
  for (const key of ['campaigns', 'movement', 'researchDesigns']) assert.equal(superQuality.body[key].length, 2);
  const privateDesign = superQuality.body.researchDesigns.find((design) => design.iterationId === privateIteration);
  assert.equal(privateDesign.revision, 0);
  assert.equal(privateDesign.declarationComplete, false);
  await db.query("UPDATE campaigns SET status='ARCHIVED' WHERE id=$1", [campaignId]);
  await assert.rejects(saveResearchDesign(adapter, superAdmin, iterationId, { ...actual, expectedRevision: 2 }), { code: 'ITERATION_NOT_FOUND' });
  assert.ok(releases >= 6, 'clients released on success, conflict, authorization denial and audit failure');
} finally {
  await db.close();
}
console.log('Research methodology validation, privacy, revision and atomic audit tests passed.');
