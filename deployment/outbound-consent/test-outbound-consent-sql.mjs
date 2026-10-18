import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { normalizeOutboundMobile, recordOutboundOptOut, hasRecordedOutboundOptOut, withOutboundConsentGuard } from './outbound-consent.repository.js';

// Isolated PostgreSQL engine only. This file never loads the application's DB
// credentials, configured API adapter or a provider client.
const { PGlite } = await import(process.env.PGLITE_MODULE_PATH
  ? pathToFileURL(process.env.PGLITE_MODULE_PATH).href : '@electric-sql/pglite');
const pg = new PGlite();
const migration = await readFile(new URL('./035_outbound_contact_suppression.sql', import.meta.url), 'utf8');
const voter = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';
const phone = '+919876543210';
const db = { async query(sql, values = []) {
  // PGlite is single-session: helper tests model concurrent clients separately.
  if (sql.includes('pg_advisory_xact_lock')) return { rows: [], rowCount: 1 };
  const result = await pg.query(sql, values);
  return { ...result, rowCount: result.rows.length || result.affectedRows || 0 };
}, async connect() { return db; }, release() {} };
const suppressed = async (id, mobile) => (await pg.query('SELECT public.outbound_contact_is_suppressed_v1($1::uuid, $2::text) AS value', [id, mobile])).rows[0].value;

try {
  await pg.exec('CREATE TABLE public.voter_demo_calls(id uuid PRIMARY KEY)');
  await pg.exec(migration); await pg.exec(migration);
  const meta = await pg.query(`SELECT provolatile, prosecdef FROM pg_catalog.pg_proc
    WHERE oid = 'public.outbound_contact_is_suppressed_v1(uuid,text)'::regprocedure`);
  assert.deepEqual(meta.rows[0], { provolatile: 's', prosecdef: false });
  for (const value of ['9876543210', '09876543210', '919876543210', '+919876543210', '+91 98765-43210', '(098)7654.3210',
    '', null, '+19876543210', '+9876543210', '00919876543210', '1234567890', '+91+9876543210', 'call9876543210', '9876543210x']) {
    const normalized = (await pg.query('SELECT public.outbound_mobile_normalize_v1($1) AS value', [value])).rows[0].value;
    assert.equal(normalized, normalizeOutboundMobile(value), 'SQL/JS canonicalization agrees: ' + value);
  }
  assert.equal(await suppressed(voter, phone), false);
  assert.equal(await suppressed(null, phone), true);
  assert.equal(await suppressed(voter, 'invalid'), true);
  await db.query('BEGIN');
  await recordOutboundOptOut(db, { voterId: voter, phoneNumbers: ['09876543210'], source: 'SARVAM_WEBHOOK', sourceAttemptId: 'synthetic-attempt' });
  await db.query('COMMIT');
  assert.equal(await suppressed(voter, '+919999999999'), true, 'Voter identifier suppresses changed numbers');
  assert.equal(await suppressed(other, '9876543210'), true, 'Phone identifier suppresses duplicate voters');
  assert.equal(await suppressed(other, '+919999999999'), false);
  await db.query('BEGIN');
  assert.equal(await hasRecordedOutboundOptOut(db, { voterId: voter, phoneNumbers: ['invalid'] }), true);
  assert.equal(await hasRecordedOutboundOptOut(db, { voterId: other, phoneNumbers: [phone] }), true);
  assert.equal(await hasRecordedOutboundOptOut(db, { voterId: other, phoneNumbers: ['invalid', null] }), false,
    'Invalid callback phone snapshot alone is not evidence of opt-out');
  assert.equal(await hasRecordedOutboundOptOut(db, { voterId: other }), false);
  await db.query('COMMIT');
  let submitted = false;
  await assert.rejects(withOutboundConsentGuard({ voterId: other, phoneNumber: phone }, async () => { submitted = true; }, { getDb: async () => db }),
    (error) => error.code === 'OUTBOUND_CONTACT_SUPPRESSED');
  assert.equal(submitted, false);
  await db.query('BEGIN');
  assert.equal((await recordOutboundOptOut(db, { voterId: voter, phoneNumbers: [phone], sourceAttemptId: 'replayed-attempt' })).inserted, 0);
  await db.query('COMMIT');
  const rows = (await pg.query('SELECT * FROM public.outbound_contact_suppressions_v1 ORDER BY identifier_kind')).rows;
  assert.equal(rows.length, 2);
  assert.ok(rows.every((row) => /^[0-9a-f]{64}$/.test(row.identifier_hash)));
  assert.ok(rows.every((row) => row.source_attempt_id === 'synthetic-attempt'));
  assert.ok(!JSON.stringify(rows).includes('9876543210'));
  await assert.rejects(pg.query("UPDATE public.outbound_contact_suppressions_v1 SET source = 'RESET'"), /append-only/);
  await assert.rejects(pg.query('DELETE FROM public.outbound_contact_suppressions_v1'), /append-only/);
  await pg.exec(migration);
  assert.equal((await pg.query('SELECT COUNT(*)::int AS count FROM public.outbound_contact_suppressions_v1')).rows[0].count, 2,
    'Migration replay never clears opt-outs');
  await db.query('BEGIN');
  await recordOutboundOptOut(db, { voterId: other, phoneNumbers: ['+919999999999'] });
  await db.query('ROLLBACK');
  assert.equal(await suppressed(other, '+919999999999'), false, 'Callback rollback atomically rolls back its suppression writes');
  console.log('Outbound consent SQL passed: additive replay, invoker/STABLE policy, canonical parity, sticky identifiers, append-only audit and rollback.');
} finally { await pg.close(); }
