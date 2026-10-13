// Real isolated PostgreSQL-compatible execution. No RDS/AWS/Sarvam access.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { uid, actor, second, approver, checks, sourceRow, snapshot, ruleHash, reviewBody, decisionBody, isolatedRepository } from './test-call-quality-review.mjs';
const { PGlite } = await import(process.env.PGLITE_MODULE_PATH ? pathToFileURL(process.env.PGLITE_MODULE_PATH).href : '@electric-sql/pglite');
const pg = new PGlite();
const adapter = { query: (...args) => pg.query(...args), connect: async () => ({ query: (...args) => pg.query(...args), release() {} }) };
const repository = await isolatedRepository();
const deps = { normalizationRulesHash: () => ruleHash };
const campaignId = uid(1), iterationId = uid(2), executionId = uid(6);
const summaryDeps = { ...deps, analyze: async (campaign, account, selection) => {
  if (account.id === uid(16)) throw Object.assign(new Error('Denied scope'), { statusCode: 404 });
  return { campaign: { id: campaign }, scope: { iteration: { id: selection.iterationId || iterationId }, insightScope: { iterationId: selection.iterationId || iterationId } } };
} };
const get = (account = approver) => repository.getCallQualityExecution(adapter, account, executionId, deps);
const summarize = (account = { id: uid(14), role_code: 'CAMPAIGN_MANAGER' }) => repository.getCampaignCallQuality(adapter, account, campaignId, { iterationId }, summaryDeps);
try {
  await pg.exec(`
    CREATE TABLE roles (id uuid PRIMARY KEY, code text, is_active boolean NOT NULL DEFAULT true);
    CREATE TABLE users (id uuid PRIMARY KEY, role_id uuid, status text);
    CREATE TABLE campaigns (id uuid PRIMARY KEY, status text, campaign_manager_user_id uuid, created_by_user_id uuid);
    CREATE TABLE program_iterations (id uuid PRIMARY KEY, questionnaire_id uuid, questionnaire_snapshot jsonb);
    CREATE TABLE campaign_iteration_links (campaign_id uuid, iteration_id uuid);
    CREATE TABLE campaign_runs (id uuid PRIMARY KEY, iteration_id uuid);
    CREATE TABLE campaign_run_contacts (id uuid PRIMARY KEY, run_id uuid, voter_id uuid);
    CREATE TABLE call_executions (id uuid PRIMARY KEY, run_contact_id uuid, run_id uuid, voter_id uuid,
      provider_attempt_id text, status text, callback_received_at timestamptz, request_payload jsonb);
    CREATE TABLE calls (id uuid PRIMARY KEY, attempt_id text, run_id uuid, iteration_id uuid, voter_id uuid,
      connectivity_status text, interaction_transcript jsonb, response_variables jsonb);
  `);
  await pg.query("INSERT INTO roles (id,code) VALUES ($1,'ADMIN'),($2,'SUPER_ADMIN'),($3,'CAMPAIGN_MANAGER'),($4,'CAMPAIGNER')", [uid(101), uid(102), uid(103), uid(104)]);
  for (const account of [actor, second, approver, { id: uid(14), role_code: 'CAMPAIGN_MANAGER' }, { id: uid(15), role_code: 'CAMPAIGNER' }, { id: uid(16), role_code: 'CAMPAIGN_MANAGER' }]) {
    await pg.query("INSERT INTO users SELECT $1,id,'ACTIVE' FROM roles WHERE code=$2", [account.id, account.role_code]);
  }
  await pg.query("INSERT INTO campaigns VALUES ($1,'ACTIVE',$2,$3)", [campaignId, uid(14), actor.id]);
  await pg.query('INSERT INTO program_iterations VALUES ($1,$2,$3::jsonb)', [iterationId, uid(8), JSON.stringify(snapshot)]);
  await pg.query('INSERT INTO campaign_iteration_links VALUES ($1,$2)', [campaignId, iterationId]);
  await pg.query('INSERT INTO campaign_runs VALUES ($1,$2)', [uid(3), iterationId]);
  await pg.query('INSERT INTO campaign_run_contacts VALUES ($1,$2,$3)', [uid(5), uid(3), uid(4)]);
  await pg.query('INSERT INTO call_executions VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)', [executionId, uid(5), uid(3), uid(4), sourceRow.provider_attempt_id,
    'COMPLETED', sourceRow.callback_received_at, JSON.stringify(sourceRow.request_payload)]);
  await pg.query('INSERT INTO calls VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb)', [uid(7), sourceRow.provider_attempt_id, uid(3), iterationId, uid(4), 'connected',
    JSON.stringify(sourceRow.interaction_transcript), JSON.stringify(sourceRow.response_variables)]);
  // Compatibility absence returns unavailable only after existing scope auth
  // and a second precise visibility check, never for arbitrary SQL failures.
  assert.equal((await summarize()).status, 'NOT_AVAILABLE');
  await assert.rejects(summarize({ id: uid(16), role_code: 'CAMPAIGN_MANAGER' }), { statusCode: 404 });
  const migration = await readFile(new URL('./033_call_quality_review.sql', import.meta.url), 'utf8');
  await pg.exec(migration); await pg.exec(migration);
  let detail = await get(actor);
  assert.equal(detail.reviewable, true); assert.equal(detail.approvalReady, false); assert.equal(detail.permissions.canDecide, false);
  assert.equal(detail.evidenceFingerprint, reviewBody.expectedEvidenceFingerprint);
  assert.equal((await summarize()).status, 'PENDING');
  await assert.rejects(repository.getCallQualityExecution(adapter, { id: uid(14), role_code: 'CAMPAIGN_MANAGER' }, executionId, deps), { statusCode: 403 });
  await assert.rejects(repository.getCampaignCallQuality(adapter, { id: uid(15), role_code: 'CAMPAIGNER' }, campaignId, { iterationId }, summaryDeps), { statusCode: 403 });
  await assert.rejects(repository.saveCallQualityDecision(adapter, approver, executionId, { ...decisionBody, action: 'REJECT_SAMPLE' }, deps), { code: 'CALL_QUALITY_APPROVER_CONFLICT' });
  await repository.saveCallQualityReview(adapter, actor, executionId, reviewBody, deps);
  detail = await get(second); assert.equal(detail.reviews.length, 0); assert.equal(detail.ownReview, null);
  assert.equal((await summarize()).status, 'REVIEW_IN_PROGRESS');
  await assert.rejects(repository.saveCallQualityReview(adapter, actor, executionId, reviewBody, deps), { statusCode: 409 });
  await repository.saveCallQualityReview(adapter, second, executionId, reviewBody, deps);
  await assert.rejects(repository.saveCallQualityReview(adapter, approver, executionId, reviewBody, deps), { statusCode: 409 });
  detail = await get(approver); assert.equal(detail.approvalReady, true); assert.equal(detail.permissions.canReview, false); assert.equal(detail.permissions.canDecide, true);
  assert.deepEqual(detail.reviews, []);
  await assert.rejects(repository.saveCallQualityDecision(adapter, actor, executionId, decisionBody, deps), { code: 'CALL_QUALITY_APPROVER_CONFLICT' });
  await repository.saveCallQualityDecision(adapter, approver, executionId, decisionBody, deps);
  let aggregate = await summarize(); assert.equal(aggregate.status, 'SAMPLE_APPROVED_PARTIAL');
  assert.deepEqual(aggregate.counts, { reviewableCalls: 1, reviewedCalls: 1, approvedCalls: 1, rejectedCalls: 0, staleCalls: 0 });
  const serialized = JSON.stringify(aggregate);
  for (const forbidden of [executionId, uid(4), actor.id, reviewBody.note, 'PRIVATE_SOURCE_NAME', '9000000000', reviewBody.expectedEvidenceFingerprint]) assert.ok(!serialized.includes(forbidden));
  await assert.rejects(repository.saveCallQualityDecision(adapter, approver, executionId, decisionBody, deps), { code: 'CALL_QUALITY_DECISION_CONFLICT' });
  for (const table of ['call_quality_reviews', 'call_quality_decisions']) {
    await assert.rejects(pg.query(`UPDATE ${table} SET evidence_fingerprint=$1`, ['b'.repeat(64)]), { code: '55000' });
    await assert.rejects(pg.query(`DELETE FROM ${table}`), { code: '55000' });
    await assert.rejects(pg.query(`TRUNCATE ${table}`), { code: '55000' });
  }
  const retained = await pg.query('SELECT COUNT(*)::int AS n FROM call_quality_reviews'); assert.equal(retained.rows[0].n, 2);
  // Source update changes the hash without requiring any timestamps to change.
  await pg.query("UPDATE calls SET response_variables=response_variables || '{\"issue_priority\":\"Roads\"}'::jsonb WHERE id=$1", [uid(7)]);
  detail = await get(approver); assert.notEqual(detail.evidenceFingerprint, reviewBody.expectedEvidenceFingerprint);
  assert.deepEqual(detail.counts, { currentReviews: 0, staleReviews: 2 }); assert.equal(detail.approvalReady, false);
  assert.equal((await summarize()).status, 'STALE');
  await assert.rejects(repository.saveCallQualityReview(adapter, actor, executionId, reviewBody, deps), { code: 'CALL_QUALITY_EVIDENCE_CONFLICT' });
  // Failed assessments can be adjudicated as rejected without positive frozen
  // prerequisites, but two independent reviews/third actor remain mandatory.
  await pg.query('UPDATE program_iterations SET questionnaire_snapshot=$2::jsonb WHERE id=$1', [iterationId, JSON.stringify({ ...snapshot, snapshot_schema_version: 1 })]);
  const rejectionHash = (await get(actor)).evidenceFingerprint;
  const failed = { ...reviewBody, expectedEvidenceFingerprint: rejectionHash, checks: { ...checks, greetingFlow: 'FAIL' }, issueBuckets: ['GREETING_LOOP'] };
  await repository.saveCallQualityReview(adapter, actor, executionId, failed, deps);
  detail = await get(second); assert.ok(!detail.blockedReasons.includes('ALL_CHECKS_MUST_PASS_WITHOUT_ISSUES'));
  await repository.saveCallQualityReview(adapter, second, executionId, failed, deps);
  await assert.rejects(repository.saveCallQualityDecision(adapter, approver, executionId, { ...decisionBody, expectedEvidenceFingerprint: rejectionHash, expectedDecisionRevision: 1 }, deps), { code: 'CALL_QUALITY_APPROVAL_BLOCKED' });
  await repository.saveCallQualityDecision(adapter, approver, executionId, { ...decisionBody, expectedEvidenceFingerprint: rejectionHash, expectedDecisionRevision: 1,
    action: 'REJECT_SAMPLE', reason: 'Greeting repeats and the frozen source provenance needs correction.' }, deps);
  assert.equal((await summarize()).status, 'CHANGES_REQUIRED');
  await pg.query("UPDATE users SET status='INACTIVE' WHERE id=$1", [second.id]);
  detail = await get(approver); assert.equal(detail.permissions.canReview, false); assert.equal(detail.counts.currentReviews, 1);
  await assert.rejects(repository.saveCallQualityReview(adapter, second, executionId, { ...reviewBody, expectedEvidenceFingerprint: rejectionHash }, deps), { statusCode: 403 });
  await pg.query("UPDATE users SET status='ACTIVE' WHERE id=$1", [second.id]);
  await pg.query("UPDATE roles SET is_active=FALSE WHERE code='SUPER_ADMIN'");
  await assert.rejects(get(approver), { statusCode: 403 });
  await pg.query("UPDATE roles SET is_active=TRUE WHERE code='SUPER_ADMIN'");
  // Actual execution deployment is mandatory; iteration or agent catalogue
  // current config never fills a missing historic per-call version.
  await pg.query("UPDATE call_executions SET request_payload='{}'::jsonb WHERE id=$1", [executionId]);
  assert.equal((await get()).evidence.agent.basis, 'NOT_RECORDED');
  assert.equal((await summarize()).status, 'STALE');
  // Conflicting provider identity or duplicate matching rows never pass QA.
  await pg.query('INSERT INTO calls SELECT $1,attempt_id,run_id,iteration_id,$2,connectivity_status,interaction_transcript,response_variables FROM calls WHERE id=$3', [uid(50), uid(51), uid(7)]);
  detail = await get(); assert.equal(detail.reviewable, false); assert.equal(detail.evidenceFingerprint, null); assert.deepEqual(detail.evidence.transcript, []);
  await pg.query('DELETE FROM calls WHERE id=$1', [uid(50)]);
  await pg.query('UPDATE campaign_run_contacts SET voter_id=$2 WHERE id=$1', [uid(5), uid(51)]);
  await assert.rejects(get(), { statusCode: 404 });
  await pg.query('UPDATE campaign_run_contacts SET voter_id=$2 WHERE id=$1', [uid(5), uid(4)]);
  // Multi-campaign linking is ambiguous even when only one link is visible.
  await pg.query("INSERT INTO campaigns VALUES ($1,'ACTIVE',NULL,$2)", [uid(60), uid(61)]);
  await pg.query('INSERT INTO campaign_iteration_links VALUES ($1,$2)', [uid(60), iterationId]);
  await assert.rejects(get(), { statusCode: 404 }); await assert.rejects(summarize(), { statusCode: 404 });
  await pg.query('DELETE FROM campaign_iteration_links WHERE campaign_id=$1', [uid(60)]);
  // Manager reassignment cannot retain the former manager's authorized summary.
  await pg.query('UPDATE campaigns SET campaign_manager_user_id=$2 WHERE id=$1', [campaignId, uid(16)]);
  await assert.rejects(summarize(), { statusCode: 404 });
  // Source columns broken are operational failures, not compatibility zeros.
  await pg.exec('ALTER TABLE call_executions RENAME COLUMN request_payload TO broken_payload');
  await assert.rejects(summarize(approver), { code: '42703' });
  console.log('PostgreSQL call-quality schema, immutable audit, exact identity, role scope, two-person review/third approval, stale evidence and safe aggregate tests passed.');
} finally { await pg.close(); }
