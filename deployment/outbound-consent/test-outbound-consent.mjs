import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { normalizeOutboundMobile, recordOutboundOptOut, hasRecordedOutboundOptOut, withOutboundConsentGuard } from './outbound-consent.repository.js';

const voter = '00000000-0000-4000-8000-000000000001';
const otherVoter = '00000000-0000-4000-8000-000000000002';
const mobile = '+919876543210';
const hash = (value) => createHash('sha256').update(value).digest('hex');
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

// Provider-free multi-client fixture. The queue models transaction-level locks;
// the SQL companion test separately executes the real PostgreSQL definitions.
function fixture({ suppressedResult, queryError = null, commitError = null } = {}) {
  const state = { committed: new Set(), rows: [], statements: [], locks: new Map(), clients: [], waiting: 0 };
  async function acquire(db, key) {
    if (db.held.has(key)) return;
    while (state.locks.has(key)) {
      state.waiting += 1;
      await state.locks.get(key).promise;
      state.waiting -= 1;
    }
    const held = deferred(); state.locks.set(key, held); db.held.set(key, held);
  }
  function release(db) {
    for (const [key, held] of db.held) { state.locks.delete(key); held.resolve(); }
    db.held.clear();
  }
  const pool = { async connect() {
    const db = { held: new Map(), staged: [], inTransaction: false, released: false,
      async query(sql, values = []) {
        state.statements.push({ sql, values });
        if (sql === 'BEGIN') { db.inTransaction = true; return { rows: [] }; }
        if (sql === 'COMMIT') {
          if (commitError) throw commitError;
          for (const row of db.staged) { state.committed.add(row.kind + ':' + row.hash); state.rows.push(row); }
          db.staged = []; db.inTransaction = false; release(db); return { rows: [] };
        }
        if (sql === 'ROLLBACK') { db.staged = []; db.inTransaction = false; release(db); return { rows: [] }; }
        if (sql.includes('pg_advisory_xact_lock')) {
          assert.equal(db.inTransaction, true); assert.equal(values[0], 172035);
          await acquire(db, values[1]); return { rows: [] };
        }
        if (sql.includes('INSERT INTO public.outbound_contact_suppressions_v1')) {
          assert.equal(db.inTransaction, true);
          const [kind, digest, source, attempt] = values;
          const duplicate = state.committed.has(kind + ':' + digest) || db.staged.some((row) => row.kind === kind && row.hash === digest);
          if (duplicate) return { rows: [], rowCount: 0 };
          db.staged.push({ kind, hash: digest, source, attempt });
          return { rows: [{ identifier_kind: kind }], rowCount: 1 };
        }
        if (sql.includes('SELECT EXISTS') && sql.includes('outbound_contact_suppressions_v1')) {
          if (queryError) throw queryError;
          const [voterHash, phoneHashes] = values;
          const actual = state.committed.has('VOTER:' + voterHash) || phoneHashes.some((digest) => state.committed.has('PHONE:' + digest));
          return { rows: [{ suppressed: suppressedResult === undefined ? actual : suppressedResult }] };
        }
        if (sql.includes('outbound_contact_is_suppressed_v1')) {
          if (queryError) throw queryError;
          const [id, phone] = values;
          const suppressed = state.committed.has('VOTER:' + hash(id)) || state.committed.has('PHONE:' + hash(phone));
          return { rows: [{ suppressed: suppressedResult === undefined ? suppressed : suppressedResult }] };
        }
        throw new Error('Unexpected fixture statement');
      },
      release() { db.released = true; release(db); }
    };
    state.clients.push(db); return db;
  } };
  return { pool, state, getDb: async () => pool };
}

for (const value of ['9876543210', '09876543210', '919876543210', '+919876543210', '+91 98765-43210', '(098)7654.3210']) {
  assert.equal(normalizeOutboundMobile(value), mobile, value);
}
for (const value of ['', null, undefined, 9876543210, '+19876543210', '+9876543210', '00919876543210', '1234567890', '+91+9876543210', 'call9876543210', '9876543210x']) {
  assert.equal(normalizeOutboundMobile(value), null, String(value));
}

const normal = fixture();
const providerResponse = { attempt_id: 'synthetic-provider-result' };
assert.equal(await withOutboundConsentGuard({ voterId: voter.toUpperCase(), phoneNumber: '09876543210' }, async () => {
  assert.equal(normal.state.locks.size, 2, 'Locks remain held during the provider request'); return providerResponse;
}, normal), providerResponse);
assert.equal(normal.state.locks.size, 0);
assert.equal(normal.state.clients[0].released, true);
const normalLocks = normal.state.statements.filter(({ sql }) => sql.includes('advisory')).map(({ values }) => values[1]);
assert.deepEqual(normalLocks, [...normalLocks].sort());

const record = fixture();
const writer = await record.pool.connect(); await writer.query('BEGIN');
assert.deepEqual(await recordOutboundOptOut(writer, { voterId: voter, phoneNumbers: ['09876543210', mobile, 'unknown', null], source: 'SARVAM_WEBHOOK', sourceAttemptId: 'synthetic-attempt' }),
  { inserted: 2, identifiers: 2, phoneIdentifiers: 1 });
assert.equal(record.state.committed.size, 0, 'Callback owns transaction commit');
await writer.query('COMMIT');
assert.equal(record.state.committed.size, 2);
assert.ok(record.state.rows.every((row) => !JSON.stringify(row).includes('9876543210')), 'No raw phone is stored');
assert.deepEqual(record.state.statements.filter(({ sql }) => sql.includes('advisory')).map(({ values }) => values[1]), normalLocks,
  'Callback and final boundary acquire the same canonical locks');
const replayWriter = await record.pool.connect(); await replayWriter.query('BEGIN');
assert.equal((await recordOutboundOptOut(replayWriter, { voterId: voter, phoneNumbers: [mobile], sourceAttemptId: 'different-attempt' })).inserted, 0);
await replayWriter.query('COMMIT');
assert.equal(record.state.rows[0].attempt, 'synthetic-attempt', 'Replay never overwrites original opt-out evidence');
for (const [identity, expected] of [
  [{ voterId: voter, phoneNumbers: ['invalid'] }, true],
  [{ voterId: otherVoter, phoneNumbers: [mobile] }, true],
  [{ voterId: otherVoter, phoneNumbers: ['invalid'] }, false],
  [{ voterId: otherVoter }, false]
]) {
  const reader = await record.pool.connect(); await reader.query('BEGIN');
  assert.equal(await hasRecordedOutboundOptOut(reader, identity), expected);
  assert.ok(reader.held.size >= 1, 'Sticky read keeps its identity locks through the outcome write');
  await reader.query('COMMIT');
}
let providerCalls = 0;
for (const identity of [{ voterId: voter, phoneNumber: '+919999999999' }, { voterId: otherVoter, phoneNumber: '9876543210' }]) {
  await assert.rejects(withOutboundConsentGuard(identity, async () => { providerCalls += 1; }, record),
    (error) => error.code === 'OUTBOUND_CONTACT_SUPPRESSED' && error.statusCode === 409);
}
assert.equal(providerCalls, 0, 'Both voter suppression and destination suppression veto dispatch');

const voterOnly = fixture(); const voterWriter = await voterOnly.pool.connect(); await voterWriter.query('BEGIN');
assert.deepEqual(await recordOutboundOptOut(voterWriter, { voterId: voter, phoneNumbers: ['invalid'] }),
  { inserted: 1, identifiers: 1, phoneIdentifiers: 0 });
await voterWriter.query('COMMIT');
await assert.rejects(withOutboundConsentGuard({ voterId: voter, phoneNumber: mobile }, async () => { providerCalls += 1; }, voterOnly),
  (error) => error.code === 'OUTBOUND_CONTACT_SUPPRESSED');

for (const identity of [{ voterId: null, phoneNumber: mobile }, { voterId: 'bad', phoneNumber: mobile }, { voterId: voter, phoneNumber: 'unknown' }]) {
  const invalid = fixture();
  await assert.rejects(withOutboundConsentGuard(identity, async () => { providerCalls += 1; }, invalid));
  assert.equal(invalid.state.clients.length, 0, 'Invalid identity is rejected before acquiring DB resources');
}
for (const failed of [fixture({ queryError: new Error('schema missing') }), fixture({ suppressedResult: null }), fixture({ suppressedResult: 'false' })]) {
  await assert.rejects(withOutboundConsentGuard({ voterId: voter, phoneNumber: mobile }, async () => { providerCalls += 1; }, failed));
  assert.equal(failed.state.locks.size, 0); assert.equal(failed.state.clients[0].released, true);
}
const providerFailure = fixture(); const originalError = new Error('synthetic provider failure');
await assert.rejects(withOutboundConsentGuard({ voterId: voter, phoneNumber: mobile }, async () => { throw originalError; }, providerFailure),
  (error) => error === originalError);
assert.equal(providerFailure.state.locks.size, 0);
const flaggedFailure = fixture(); const alreadyUncertain = new Error('provider state already uncertain');
alreadyUncertain.code = 'PROVIDER_STATE_UNCERTAIN'; alreadyUncertain.providerSubmissionMayHaveOccurred = true;
await assert.rejects(withOutboundConsentGuard({ voterId: voter, phoneNumber: mobile }, async () => { throw alreadyUncertain; }, flaggedFailure),
  (error) => error === alreadyUncertain && error.providerSubmissionMayHaveOccurred === true);
const commitFailure = fixture({ commitError: new Error('synthetic connection failure') });
await assert.rejects(withOutboundConsentGuard({ voterId: voter, phoneNumber: mobile }, async () => providerResponse, commitFailure),
  (error) => error.code === 'OUTBOUND_SUBMISSION_STATE_UNCERTAIN' && error.providerSubmissionMayHaveOccurred === true);

// Opt-out wins the lock: a waiting submission sees the committed veto.
const first = fixture(); const firstWriter = await first.pool.connect(); await firstWriter.query('BEGIN');
await recordOutboundOptOut(firstWriter, { voterId: voter, phoneNumbers: [mobile] });
const waiting = withOutboundConsentGuard({ voterId: voter, phoneNumber: mobile }, async () => { providerCalls += 1; }, first);
const rejection = assert.rejects(waiting, (error) => error.code === 'OUTBOUND_CONTACT_SUPPRESSED');
await Promise.resolve(); await firstWriter.query('COMMIT'); await rejection;
assert.equal(providerCalls, 0);

// Submission wins the lock: its already accepted call is not retrospectively
// cancelled. Opt-out commits afterwards and blocks every subsequent submission.
const second = fixture(); const entered = deferred(); const finish = deferred();
const accepted = withOutboundConsentGuard({ voterId: voter, phoneNumber: mobile }, async () => {
  providerCalls += 1; entered.resolve(); await finish.promise; return providerResponse;
}, second);
await entered.promise;
const secondWriter = await second.pool.connect(); await secondWriter.query('BEGIN');
const optout = recordOutboundOptOut(secondWriter, { voterId: voter, phoneNumbers: ['09876543210'] });
await Promise.resolve(); assert.equal(second.state.committed.size, 0);
finish.resolve(); assert.equal(await accepted, providerResponse);
await optout; await secondWriter.query('COMMIT');
await assert.rejects(withOutboundConsentGuard({ voterId: voter, phoneNumber: mobile }, async () => { providerCalls += 1; }, second),
  (error) => error.code === 'OUTBOUND_CONTACT_SUPPRESSED');
assert.equal(providerCalls, 1);
console.log('Outbound consent helper passed: canonical identities, sticky suppression, fail-closed dispatch, lock ordering and provider-free concurrency.');
