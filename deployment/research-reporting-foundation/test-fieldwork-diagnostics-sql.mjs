// Isolated PostgreSQL regression only. No production DB, AWS or provider access.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { loadFieldworkDiagnostics } from './fieldwork-diagnostics.repository.js';
import { sanitizeFieldworkDiagnostics } from './fieldwork-diagnostics.js';
const { PGlite } = await import(process.env.PGLITE_MODULE_PATH
  ? pathToFileURL(process.env.PGLITE_MODULE_PATH).href : '@electric-sql/pglite');
const db = new PGlite();
const uid = (value) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const campaignId = uid(1), iterationId = uid(2), run1 = uid(3), run2 = uid(4), run3 = uid(5);
const scope = { campaignId, iterationId, filters: { gender: null, ageBand: null, mandal: null } };
const load = (extra = {}) => loadFieldworkDiagnostics(db, { ...scope, iterationCompleted: true, analysisRespondentBase: 5, ...extra });
try {
  await db.exec(`
    CREATE TABLE campaigns(id uuid PRIMARY KEY, status text);
    CREATE TABLE program_iterations(id uuid PRIMARY KEY);
    CREATE TABLE campaign_iteration_links(campaign_id uuid, iteration_id uuid);
    CREATE TABLE campaign_runs(id uuid PRIMARY KEY, iteration_id uuid, run_number integer, created_at timestamptz, updated_at timestamptz);
    CREATE TABLE campaign_run_contacts(id uuid PRIMARY KEY, run_id uuid, voter_id uuid, attempt_status text, attempt_count integer);
    CREATE TABLE voter_master(id uuid PRIMARY KEY, gender text, age integer, mandal_name_source text);
    CREATE TABLE call_executions(id uuid PRIMARY KEY, run_contact_id uuid, run_id uuid, voter_id uuid,
      status text, provider_attempt_id text, callback_received_at timestamptz, created_at timestamptz, updated_at timestamptz);
    CREATE TABLE calls(id uuid PRIMARY KEY, attempt_id text, iteration_id uuid, run_id uuid, voter_id uuid,
      connectivity_status text, response_variables jsonb, first_seen_at timestamptz, updated_at timestamptz);
  `);
  await db.query("INSERT INTO campaigns VALUES($1, 'ACTIVE')", [campaignId]);
  await db.query('INSERT INTO program_iterations VALUES($1)', [iterationId]);
  await db.query('INSERT INTO campaign_iteration_links VALUES($1,$2)', [campaignId, iterationId]);
  for (const [id, number] of [[run1, 1], [run2, 2], [run3, 3]]) {
    await db.query("INSERT INTO campaign_runs VALUES($1,$2,$3,'2026-10-10T10:00:00Z','2026-10-10T11:00:00Z')", [id, iterationId, number]);
  }
  for (let index = 0; index < 50; index++) {
    const voterId = uid(100 + index), group = Math.floor(index / 5);
    await db.query('INSERT INTO voter_master VALUES($1,$2,$3,$4)', [voterId, index < 25 ? 'F' : 'male',
      [22, 35, 45, 60, 16][Math.floor(index / 10)], index < 25 ? 'Serilingampally' : 'Another Mandal']);
    // Initial cohort and retries retain the same database voter IDs.
    for (const [runId, offset] of [[run1, 1000], [run2, 2000], [run3, 3000]]) {
      await db.query("INSERT INTO campaign_run_contacts VALUES($1,$2,$3,'PENDING',0)", [uid(offset + index), runId, voterId]);
    }
    if (group === 8) continue; // NOT_ATTEMPTED.
    const provider = group === 7 ? null : `attempt-${index}`;
    const status = group === 1 ? 'SUBMITTED' : group === 9 ? 'CANCELLED'
      : [2, 4, 5, 6, 7].includes(group) ? 'FAILED' : 'COMPLETED';
    const callback = [1, 2, 7].includes(group) ? null : '2026-10-11T11:00:00Z';
    await db.query("INSERT INTO call_executions VALUES($1,$2,$3,$4,$5,$6,$7,'2026-10-11T10:00:00Z','2026-10-11T11:00:00Z')",
      [uid(4000 + index), uid(2000 + index), run2, voterId, status, provider, callback]);
    if ([1, 2, 7].includes(group)) continue;
    const connectivity = group === 0 || group === 3 ? 'connected'
      : group === 4 ? 'busy' : group === 5 ? 'no_answer' : group === 6 ? 'failed' : 'voicemail';
    await db.query("INSERT INTO calls VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,'2026-10-11T10:00:00Z','2026-10-11T12:00:00Z')",
      [uid(5000 + index), provider, iterationId, run2, voterId, connectivity,
        JSON.stringify(group === 0 ? { user_name: 'NEVER_EXPORT_NAME', phone_number: '9999999999' } : {})]);
  }
  let result = await load();
  assert.equal(result.status, 'AVAILABLE');
  assert.equal(result.coverage.selectedBase, 50);
  assert.deepEqual(result.coverage.stages.map((row) => row.participants), [50, 45, 10, 5]);
  assert.ok(result.outcomes.rows.every((row) => row.participants === 5));
  assert.equal(result.observedAt, '2026-10-11T12:00:00.000Z');
  assert.equal(result.sources.analysisBaseAlignment, 'MATCHED');
  assert.ok(!JSON.stringify(result).includes('NEVER_EXPORT_NAME'));
  assert.ok(!JSON.stringify(result).includes('9999999999'));
  assert.ok(!JSON.stringify(result).includes(uid(100)));
  assert.deepEqual(sanitizeFieldworkDiagnostics(result, scope), result);
  // Empty provider IDs are failed submissions, never provider identity matches.
  await db.query("UPDATE call_executions SET provider_attempt_id='   ' WHERE id IN($1,$2)", [uid(4035), uid(4036)]);
  result = await load();
  assert.equal(result.status, 'AVAILABLE');
  assert.equal(result.outcomes.rows.find((row) => row.key === 'SUBMISSION_FAILED').participants, 5);
  // Nonempty technical-only objects prove availability, not questionnaire completion.
  assert.equal(result.coverage.stages[3].participants, 5);
  assert.equal(result.sources.surveyCompletion, 'UNAVAILABLE');
  // Unmatched standalone tests and wrong-provider attempts cannot increase availability.
  await db.query("INSERT INTO calls VALUES($1,'standalone',$2,$3,$4,'connected','{\"party_salience\":\"BRS\"}'::jsonb,'2026-10-12T10:00:00Z','2026-10-12T10:00:00Z')",
    [uid(6000), iterationId, run3, uid(145)]);
  result = await load();
  assert.equal(result.coverage.stages[3].participants, 5);
  assert.equal(result.observedAt, '2026-10-11T12:00:00.000Z');
  // A later unsuccessful retry never erases an earlier matched structured record.
  await db.query("INSERT INTO call_executions VALUES($1,$2,$3,$4,'FAILED','later-no-answer','2026-10-12T11:00:00Z','2026-10-12T10:00:00Z','2026-10-12T11:00:00Z')",
    [uid(6001), uid(3000), run3, uid(100)]);
  await db.query("INSERT INTO calls VALUES($1,'later-no-answer',$2,$3,$4,'no_answer','{}'::jsonb,'2026-10-12T10:00:00Z','2026-10-12T11:00:00Z')",
    [uid(6002), iterationId, run3, uid(100)]);
  result = await load();
  assert.equal(result.outcomes.rows[0].participants, 5);
  assert.equal(result.observedAt, '2026-10-12T11:00:00.000Z');
  // Filters bind both cohort and record denominators; Run ID is not a filter.
  result = await load({ filters: { gender: 'Female', ageBand: null, mandal: null, runId: run1 } });
  assert.equal(result.coverage.selectedBase, 25);
  assert.equal(result.coverage.stages[3].participants, 5);
  assert.deepEqual(result.scope.filters, { gender: 'Female', ageBand: null, mandal: null });
  result = await load({ filters: { gender: null, ageBand: '18–29', mandal: 'Serilingampally' } });
  assert.equal(result.coverage.selectedBase, 10);
  assert.equal(result.coverage.stages[3].participants, 5);
  result = await load({ filters: { gender: null, ageBand: null, mandal: 'Missing Mandal' }, analysisRespondentBase: 0 });
  assert.equal(result.coverage.selectedBase, 0);
  assert.equal(result.outcomes.rows[0].participants, 0);
  assert.equal(result.coverage.yield, null);
  // Missing voter master data retains contact IDs and counts Unknown attributes.
  await db.query('DELETE FROM voter_master WHERE id=$1', [uid(100)]);
  result = await load();
  assert.equal(result.coverage.selectedBase, 50);
  assert.equal(result.coverage.stages[3].participants, 5);
  assert.equal(result.demographics.gender.status, 'WITHHELD');
  assert.equal(result.demographics.mandal.status, 'WITHHELD');
  assert.deepEqual(result.demographics.mandal.rows, []);
  await db.query("INSERT INTO voter_master VALUES($1,'F',22,'Serilingampally')", [uid(100)]);
  // Contacts introduced later are flagged, never treated as initial participants.
  await db.query("INSERT INTO campaign_run_contacts VALUES($1,$2,$3,'PENDING',0)", [uid(6500), run3, uid(6501)]);
  result = await load({ analysisRespondentBase: 6 });
  assert.equal(result.coverage.selectedBase, 50);
  assert.equal(result.sources.outsideInitialCohort, 'OBSERVED');
  assert.equal(result.sources.analysisBaseAlignment, 'MISMATCH');
  // Ambiguous initial Run, unknown status, and cross-identity attempts fail closed.
  await db.query("INSERT INTO campaign_runs VALUES($1,$2,1,'2026-10-01T10:00:00Z','2026-10-01T11:00:00Z')", [uid(6600), iterationId]);
  assert.equal((await load()).reason, 'INITIAL_COHORT_UNAVAILABLE');
  await db.query('DELETE FROM campaign_runs WHERE id=$1', [uid(6600)]);
  await db.query("UPDATE call_executions SET status='UNSUPPORTED_STATUS' WHERE id=$1", [uid(4000)]);
  assert.equal((await load()).reason, 'SOURCE_INTEGRITY_UNVERIFIED');
  await db.query("UPDATE call_executions SET status='COMPLETED' WHERE id=$1", [uid(4000)]);
  await db.query("INSERT INTO calls VALUES($1,'attempt-0',$2,$3,$4,'connected','{}'::jsonb,'2026-10-12T10:00:00Z','2026-10-12T10:00:00Z')",
    [uid(6700), iterationId, run2, uid(101)]);
  assert.equal((await load()).reason, 'SOURCE_INTEGRITY_UNVERIFIED');
  await db.query('DELETE FROM calls WHERE id=$1', [uid(6700)]);
  await db.query('UPDATE call_executions SET voter_id=$1 WHERE id=$2', [uid(101), uid(4000)]);
  assert.equal((await load()).reason, 'SOURCE_INTEGRITY_UNVERIFIED');
  await db.query('UPDATE call_executions SET voter_id=$1 WHERE id=$2', [uid(100), uid(4000)]);
  assert.equal((await load({ campaignId: uid(9999) })).reason, 'INITIAL_COHORT_UNAVAILABLE');
  // A single small final cell suppresses all stages, outcomes and composition.
  await db.query('DELETE FROM campaign_run_contacts WHERE id=$1', [uid(1040)]);
  result = await load();
  assert.equal(result.status, 'WITHHELD');
  assert.equal(result.coverage.selectedBase, null);
  assert.equal(result.coverage.yield, null);
  assert.ok(result.outcomes.rows.every((row) => row.participants === null));
  assert.ok(Object.values(result.demographics).every((partition) => partition.rows.length === 0));
  // Both explicit missing-column/relation paths preserve the known scope.
  await db.exec('ALTER TABLE campaign_runs DROP COLUMN updated_at');
  result = await load();
  assert.equal(result.reason, 'SOURCE_SCHEMA_UNAVAILABLE'); assert.deepEqual(result.scope, scope);
  await db.exec('DROP TABLE call_executions');
  result = await load();
  assert.equal(result.reason, 'SOURCE_SCHEMA_UNAVAILABLE'); assert.deepEqual(result.scope, scope);
  console.log('PostgreSQL fieldwork matched-cohort, retry deduplication, filters, availability, outcomes, integrity and source-schema regressions passed.');
} finally {
  await db.close();
}
