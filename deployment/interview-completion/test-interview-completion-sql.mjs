// Real isolated PostgreSQL-compatible reads only; no RDS or provider access.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { uid, actor, snapshot, sourceRow, isolatedRepository } from './test-interview-completion.mjs';
const { PGlite } = await import(process.env.PGLITE_MODULE_PATH ? pathToFileURL(process.env.PGLITE_MODULE_PATH).href : '@electric-sql/pglite');
const pg = new PGlite();
const statements = [], adapter = { query: (...args) => pg.query(...args), connect: async () => ({
  query: (...args) => { statements.push(args[0]); return pg.query(...args); }, release() {} }) };
const repository = await isolatedRepository();
const campaignId = uid(1), iterationId = uid(2), run1 = uid(3), run2 = uid(30), run3 = uid(31);
const manager = { id: uid(14), role_code: 'CAMPAIGN_MANAGER' }, admin = { id: uid(11), role_code: 'ADMIN' };
const deps = { analyze: async (campaign, account, selection) => ({ campaign: { id: campaign },
  scope: { iteration: { id: selection.iterationId || iterationId }, insightScope: { iterationId: selection.iterationId || iterationId } } }) };
const summarize = (account = manager, selection = { iterationId }) => repository.getCampaignInterviewCompletion(adapter, account, campaignId, selection, deps);
const get = (executionId = uid(4000), account = actor) => repository.getInterviewCompletionExecution(adapter, account, executionId);
async function addExecution(index, runId, offset, changes = {}) {
  const row = sourceRow(changes), executionId = uid(offset + index), contactOffset = runId === run1 ? 1000 : runId === run2 ? 2000 : 3000;
  const provider = `synthetic-${offset}-${index}`;
  await pg.query(`INSERT INTO call_executions VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [executionId, uid(contactOffset + index), runId,
    uid(100 + index), provider, row.execution_status, row.callback_received_at,
    changes.created_at || '2026-10-12T10:00:00Z', changes.updated_at || '2026-10-12T10:01:00Z']);
  if (changes.skip_call) return;
  await pg.query(`INSERT INTO calls VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9)`, [uid(offset + 1000 + index), provider,
    runId, iterationId, uid(100 + index), row.connectivity_status, JSON.stringify(row.interaction_transcript), JSON.stringify(row.response_variables),
    changes.updated_at || '2026-10-12T10:01:00Z']);
}
try {
  await pg.exec(`
    CREATE TABLE roles(id uuid PRIMARY KEY, code text, is_active boolean NOT NULL DEFAULT true);
    CREATE TABLE users(id uuid PRIMARY KEY, role_id uuid, status text);
    CREATE TABLE campaigns(id uuid PRIMARY KEY, status text, campaign_manager_user_id uuid, created_by_user_id uuid);
    CREATE TABLE program_iterations(id uuid PRIMARY KEY, questionnaire_id uuid, questionnaire_snapshot jsonb);
    CREATE TABLE campaign_iteration_links(campaign_id uuid, iteration_id uuid);
    CREATE TABLE campaign_runs(id uuid PRIMARY KEY, iteration_id uuid, run_number integer);
    CREATE TABLE campaign_run_contacts(id uuid PRIMARY KEY, run_id uuid, voter_id uuid, attempt_count integer DEFAULT 0, attempt_status text DEFAULT 'PENDING');
    CREATE TABLE call_executions(id uuid PRIMARY KEY, run_contact_id uuid, run_id uuid, voter_id uuid,
      provider_attempt_id text, status text, callback_received_at timestamptz, created_at timestamptz, updated_at timestamptz);
    CREATE TABLE calls(id uuid PRIMARY KEY, attempt_id text, run_id uuid, iteration_id uuid, voter_id uuid,
      connectivity_status text, interaction_transcript jsonb, response_variables jsonb, updated_at timestamptz);
  `);
  await pg.query("INSERT INTO roles VALUES($1,'SUPER_ADMIN',true),($2,'ADMIN',true),($3,'CAMPAIGN_MANAGER',true),($4,'CAMPAIGNER',true)", [uid(101), uid(102), uid(103), uid(104)]);
  for (const account of [actor, admin, manager, { id: uid(16), role_code: 'CAMPAIGN_MANAGER' }, { id: uid(15), role_code: 'CAMPAIGNER' }]) {
    await pg.query("INSERT INTO users SELECT $1,id,'ACTIVE' FROM roles WHERE code=$2", [account.id, account.role_code]);
  }
  await pg.query("INSERT INTO campaigns VALUES($1,'ACTIVE',$2,$3)", [campaignId, manager.id, admin.id]);
  await pg.query('INSERT INTO program_iterations VALUES($1,$2,$3::jsonb)', [iterationId, uid(8), JSON.stringify(snapshot())]);
  await pg.query('INSERT INTO campaign_iteration_links VALUES($1,$2)', [campaignId, iterationId]);
  for (const [id, number] of [[run1, 1], [run2, 2], [run3, 3]]) await pg.query('INSERT INTO campaign_runs VALUES($1,$2,$3)', [id, iterationId, number]);
  for (let index = 0; index < 35; index++) {
    for (const [runId, offset] of [[run1, 1000], [run2, 2000], [run3, 3000]]) {
      await pg.query('INSERT INTO campaign_run_contacts (id,run_id,voter_id) VALUES($1,$2,$3)', [uid(offset + index), runId, uid(100 + index)]);
    }
    const group = Math.floor(index / 5); if (group === 6) continue;
    const changes = group === 1 ? { response_variables: { public_need: 'Roads' } } : group === 2 ? { response_variables: { public_need: 'CANT_SAY', awareness: 'REFUSED' } }
      : group === 3 ? { callback_received_at: null } : group === 4 ? { execution_status: 'FAILED', connectivity_status: 'busy', interaction_transcript: [], response_variables: {} }
        : group === 5 ? { execution_status: 'SUBMITTED', callback_received_at: null, skip_call: true } : {};
    await addExecution(index, run1, 4000, changes);
  }
  let aggregate = await summarize();
  assert.equal(aggregate.status, 'AVAILABLE'); assert.equal(aggregate.counts.selectedBase, 35);
  assert.deepEqual(Object.values(aggregate.counts).slice(1), Array(7).fill(5));
  assert.equal(aggregate.observedAt, '2026-10-12T10:01:00.000Z');
  assert.equal((await get()).status, 'COMPLETE_RECORDED');
  assert.equal((await get(uid(4000), admin)).status, 'COMPLETE_RECORDED');
  await assert.rejects(get(uid(4000), manager), { statusCode: 403 });
  await assert.rejects(summarize({ id: uid(15), role_code: 'CAMPAIGNER' }), { statusCode: 403 });
  await assert.rejects(summarize(manager, { iterationId, runId: run1 }), { statusCode: 400 });
  await assert.rejects(repository.getCampaignInterviewCompletion(adapter, manager, campaignId, { iterationId }, {
    analyze: async () => ({ campaign: { id: uid(90000) }, scope: { insightScope: { iterationId }, iteration: { id: iterationId } } })
  }), { statusCode: 409 });
  await assert.rejects(repository.getCampaignInterviewCompletion(adapter, manager, campaignId, { iterationId }, {
    analyze: async () => { throw Object.assign(new Error('Explicit authorization denied'), { statusCode: 404 }); }
  }), { statusCode: 404 });
  const failedDb = { connect: async () => ({ query: async (sql) => {
    if (sql.startsWith('BEGIN') || sql === 'ROLLBACK') return { rows: [] };
    throw Object.assign(new Error('Database permissions unavailable'), { code: '42501' }); }, release() {} }) };
  await assert.rejects(repository.getCampaignInterviewCompletion(failedDb, manager, campaignId, { iterationId }, deps), { code: '42501' });
  for (const secret of ['PRIVATE_NAME', '9999999999', 'synthetic-4000', 'Roads', uid(100), uid(4000), 'Q_NEED']) assert.ok(!JSON.stringify(aggregate).includes(secret));
  assert.ok(statements.every((sql) => !/\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/.test(sql)));
  assert.ok(statements.some((sql) => /BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/.test(sql)));
  // A later retry is assessed on its own, never unioned with an older partial.
  for (let index = 5; index < 10; index++) await addExecution(index, run2, 6000, {
    response_variables: { awareness: 'Familiar' }, created_at: '2026-10-13T10:00:00Z', updated_at: '2026-10-13T10:01:00Z' });
  aggregate = await summarize(); assert.equal(aggregate.counts.partialRecorded, 5); assert.equal(aggregate.counts.completeRecorded, 5);
  assert.equal(aggregate.observedAt, '2026-10-13T10:01:00.000Z');
  // An older execution updated later does not replace a newly created attempt.
  await pg.query("UPDATE call_executions SET updated_at='2026-10-14T12:00:00Z' WHERE id=$1", [uid(4005)]);
  assert.equal((await summarize()).observedAt, '2026-10-13T10:01:00.000Z');
  // Latest active retries cannot inherit earlier complete answer records.
  for (let index = 0; index < 5; index++) await addExecution(index, run3, 8000, { execution_status: 'SUBMITTED', callback_received_at: null,
    skip_call: true, created_at: '2026-10-14T10:00:00Z', updated_at: '2026-10-14T10:01:00Z' });
  aggregate = await summarize(); assert.equal(aggregate.status, 'AVAILABLE'); assert.equal(aggregate.counts.completeRecorded, 0); assert.equal(aggregate.counts.inProgress, 10);
  await pg.query('DELETE FROM call_executions WHERE id=ANY($1::uuid[])', [Array.from({ length: 5 }, (_, index) => uid(8000 + index))]);
  // Unknown creation chronology cannot rank behind and resurrect oldcomplete.
  await pg.query("INSERT INTO call_executions VALUES($1,$2,$3,$4,'undated','SUBMITTED',NULL,NULL,'2026-10-14T12:00:00Z')",
    [uid(8500), uid(2000), run2, uid(100)]);
  aggregate = await summarize(); assert.equal(aggregate.status, 'WITHHELD');
  await pg.query('DELETE FROM call_executions WHERE id=$1', [uid(8500)]);
  // Orphan calls inside the retained cohort cannot masquerade as not attempted.
  for (let index = 30; index < 35; index++) await pg.query(`INSERT INTO calls VALUES($1,$2,$3,$4,$5,'connected',$6::jsonb,$7::jsonb,'2026-10-15T10:00:00Z')`,
    [uid(10000 + index), `orphan-${index}`, run2, iterationId, uid(100 + index), JSON.stringify(sourceRow().interaction_transcript), JSON.stringify(sourceRow().response_variables)]);
  aggregate = await summarize(); assert.equal(aggregate.counts.notAttempted, 0); assert.equal(aggregate.counts.technicallyUnresolved, 10);
  await pg.query('DELETE FROM calls WHERE id=ANY($1::uuid[])', [Array.from({ length: 5 }, (_, index) => uid(10030 + index))]);
  // An older complete attempt cannot hide an additional unbound raw call.
  await pg.query(`INSERT INTO calls VALUES($1,'unbound-newer',$2,$3,$4,'connected',$5::jsonb,$6::jsonb,'2026-10-15T12:00:00Z')`,
    [uid(11000), run2, iterationId, uid(100), JSON.stringify(sourceRow().interaction_transcript), JSON.stringify(sourceRow().response_variables)]);
  assert.equal((await summarize()).status, 'WITHHELD');
  await pg.query('DELETE FROM calls WHERE id=$1', [uid(11000)]);
  // Outside-initial-cohort contacts do not enlarge or rewrite the denominator.
  await pg.query('INSERT INTO campaign_run_contacts (id,run_id,voter_id) VALUES($1,$2,$3)', [uid(20000), run2, uid(20001)]);
  await pg.query("INSERT INTO call_executions VALUES($1,$2,$3,$4,'outside','SUBMITTED',NULL,'2026-10-16T10:00:00Z','2026-10-16T10:00:00Z')", [uid(20002), uid(20000), run2, uid(20001)]);
  assert.equal((await summarize()).counts.selectedBase, 35);
  // Duplicate matched call/provider sources suppress the entire partition.
  await pg.query('INSERT INTO calls SELECT $1,attempt_id,run_id,iteration_id,voter_id,connectivity_status,interaction_transcript,response_variables,updated_at FROM calls WHERE id=$2', [uid(21000), uid(5000)]);
  assert.equal((await get()).status, 'TECHNICALLY_UNRESOLVED');
  aggregate = await summarize(); assert.equal(aggregate.status, 'WITHHELD'); assert.ok(Object.values(aggregate.counts).every((value) => value === null));
  await pg.query('DELETE FROM calls WHERE id=$1', [uid(21000)]);
  // Contact/voter mismatch is refused privately and unresolved in aggregates.
  await pg.query('UPDATE call_executions SET voter_id=$2 WHERE id=$1', [uid(4000), uid(101)]);
  await assert.rejects(get(), { statusCode: 404 });
  aggregate = await summarize(); assert.equal(aggregate.status, 'WITHHELD');
  await pg.query('UPDATE call_executions SET voter_id=$2 WHERE id=$1', [uid(4000), uid(100)]);
  // A callback that claims busy alongside retained answers is contradictory.
  await pg.query("UPDATE calls SET connectivity_status='busy' WHERE id=$1", [uid(5000)]);
  assert.equal((await get()).status, 'TECHNICALLY_UNRESOLVED');
  await pg.query("UPDATE calls SET connectivity_status='connected' WHERE id=$1", [uid(5000)]);
  // No frozen completion contract is repaired from present-day data.
  await pg.query('UPDATE program_iterations SET questionnaire_snapshot=$2::jsonb WHERE id=$1', [iterationId, JSON.stringify({ ...snapshot(), snapshot_schema_version: 1 })]);
  assert.equal((await get()).status, 'TECHNICALLY_UNRESOLVED'); assert.equal((await get()).source.frozenInstrumentHash, null);
  await pg.query('UPDATE program_iterations SET questionnaire_snapshot=$2::jsonb WHERE id=$1', [iterationId, JSON.stringify(snapshot())]);
  // Duplicate initial voter IDs make the cohort unavailable, not fake zeros.
  await pg.query('INSERT INTO campaign_run_contacts (id,run_id,voter_id) VALUES($1,$2,$3)', [uid(22000), run1, uid(100)]);
  aggregate = await summarize(); assert.equal(aggregate.reason, 'RETAINED_BASE_COHORT_UNAVAILABLE'); assert.ok(Object.values(aggregate.counts).every((value) => value === null));
  await pg.query('DELETE FROM campaign_run_contacts WHERE id=$1', [uid(22000)]);
  await pg.query('INSERT INTO campaign_runs VALUES($1,$2,1)', [uid(22001), iterationId]);
  assert.equal((await summarize()).status, 'NOT_AVAILABLE');
  await pg.query('DELETE FROM campaign_runs WHERE id=$1', [uid(22001)]);
  // Multi-campaign linkage is explicitly unavailable even for Super Admin.
  await pg.query("INSERT INTO campaigns VALUES($1,'ACTIVE',NULL,$2)", [uid(23000), admin.id]);
  await pg.query('INSERT INTO campaign_iteration_links VALUES($1,$2)', [uid(23000), iterationId]);
  assert.equal((await summarize(actor)).reason, 'AMBIGUOUS_SOURCE_SCOPE'); await assert.rejects(get(), { statusCode: 404 });
  await pg.query('DELETE FROM campaign_iteration_links WHERE campaign_id=$1', [uid(23000)]);
  // Reassignment and active-role changes are checked after scope resolution.
  await pg.query('UPDATE campaigns SET campaign_manager_user_id=$2 WHERE id=$1', [campaignId, uid(16)]);
  await assert.rejects(summarize(), { statusCode: 404 });
  await pg.query('UPDATE campaigns SET campaign_manager_user_id=$2 WHERE id=$1', [campaignId, manager.id]);
  await pg.query("UPDATE users SET status='INACTIVE' WHERE id=$1", [manager.id]); await assert.rejects(summarize(), { statusCode: 403 });
  await pg.query("UPDATE users SET status='ACTIVE' WHERE id=$1", [manager.id]);
  await pg.query("UPDATE roles SET is_active=false WHERE code='SUPER_ADMIN'"); await assert.rejects(get(), { statusCode: 403 });
  await pg.query("UPDATE roles SET is_active=true WHERE code='SUPER_ADMIN'");
  await pg.exec('ALTER TABLE calls RENAME COLUMN response_variables TO unsupported_outputs');
  aggregate = await summarize(); assert.equal(aggregate.reason, 'SOURCE_SCHEMA_UNAVAILABLE'); assert.ok(Object.values(aggregate.counts).every((value) => value === null));
  await pg.exec('ALTER TABLE calls RENAME COLUMN unsupported_outputs TO response_variables');
  // Claimed attempts require per-contact executions, including a lost later
  // retry which would otherwise expose an older complete interview.
  await pg.query('UPDATE campaign_run_contacts SET attempt_count=1 WHERE id=$1', [uid(2030)]);
  assert.equal((await summarize()).status, 'WITHHELD');
  await pg.query("UPDATE campaign_run_contacts SET attempt_count=0,attempt_status='SUBMITTED' WHERE id=$1", [uid(2030)]);
  assert.equal((await summarize()).status, 'WITHHELD');
  await pg.query("UPDATE campaign_run_contacts SET attempt_status='PENDING' WHERE id=$1", [uid(2030)]);
  assert.equal((await summarize()).counts.notAttempted, 5);
  await pg.query('UPDATE campaign_run_contacts SET attempt_count=1 WHERE id=$1', [uid(2000)]);
  assert.equal((await summarize()).status, 'WITHHELD');
  await pg.query("UPDATE campaign_run_contacts SET attempt_count=0,attempt_status='SUBMITTED' WHERE id=$1", [uid(2000)]);
  assert.equal((await summarize()).status, 'WITHHELD');
  await pg.query("UPDATE campaign_run_contacts SET attempt_status='PENDING' WHERE id=$1", [uid(2000)]);
  assert.equal((await summarize()).counts.completeRecorded, 5);
  await pg.exec('ALTER TABLE campaign_run_contacts RENAME COLUMN attempt_count TO unsupported_attempt_count');
  assert.equal((await summarize()).reason, 'SOURCE_SCHEMA_UNAVAILABLE');
  await pg.exec('ALTER TABLE campaign_run_contacts RENAME COLUMN unsupported_attempt_count TO attempt_count');
  // A retained empty Run 1 is a known observed zero, not schema absence.
  await pg.query('DELETE FROM campaign_run_contacts WHERE run_id=$1', [run1]);
  aggregate = await summarize(); assert.equal(aggregate.status, 'AVAILABLE'); assert.ok(Object.values(aggregate.counts).every((value) => value === 0));
  console.log('PostgreSQL interview completion exact identity, latest-only cohort, orphan/mismatch, privacy partition, current role scope and read-only compatibility tests passed.');
} finally { await pg.close(); await repository.cleanup(); }
