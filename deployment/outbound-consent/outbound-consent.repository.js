import { createHash } from 'node:crypto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOCK_NAMESPACE = 172035;

function consentError(message, statusCode, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

export function normalizeOutboundMobile(phone) {
  if (typeof phone !== 'string') return null;
  const compact = phone.trim().replace(/[\s().-]/g, '');
  if (/^\+91[6-9][0-9]{9}$/.test(compact)) return compact;
  if (/^91[6-9][0-9]{9}$/.test(compact)) return '+' + compact;
  if (/^0[6-9][0-9]{9}$/.test(compact)) return '+91' + compact.slice(1);
  if (/^[6-9][0-9]{9}$/.test(compact)) return '+91' + compact;
  return null;
}

function voterIdentity(value) {
  if (typeof value !== 'string' || !UUID.test(value.trim())) {
    throw consentError('A valid voter identity is required before outbound contact', 409, 'OUTBOUND_VOTER_ID_REQUIRED');
  }
  return value.trim().toLowerCase();
}

function identifier(kind, value) {
  return { kind, hash: createHash('sha256').update(value, 'utf8').digest('hex') };
}

function identifiers(voterId, phoneNumbers) {
  const result = new Map();
  for (const entry of [identifier('VOTER', voterId), ...phoneNumbers.map((phone) => identifier('PHONE', phone))]) {
    result.set(entry.kind + ':' + entry.hash, entry);
  }
  return [...result.entries()].sort(([a], [b]) => a.localeCompare(b, 'en')).map(([, entry]) => entry);
}

async function lockIdentifiers(db, entries) {
  // One canonical, sorted lock order is shared by the callback and dispatcher.
  // Locks survive until the caller's COMMIT/ROLLBACK, not just this function.
  for (const entry of entries) {
    await db.query('SELECT pg_catalog.pg_advisory_xact_lock($1, pg_catalog.hashtext($2))',
      [LOCK_NAMESPACE, 'outbound-consent-v1:' + entry.kind + ':' + entry.hash]);
  }
}

function boundedAuditValue(value, maximum, field, nullable = false) {
  if (nullable && (value === null || value === undefined)) return null;
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maximum || /[\u0000-\u001f\u007f]/.test(value)) {
    throw consentError('Invalid outbound opt-out audit ' + field, 400, 'OUTBOUND_OPTOUT_AUDIT_INVALID');
  }
  return value.trim();
}

/**
 * Caller MUST own an open transaction and commit this alongside its callback
 * audit. This function never commits, rewrites history or clears suppression.
 * Invalid callback phone snapshots are ignored so voter-level opt-out is not
 * lost; valid attempt/current numbers supplied by the caller are all retained.
 */
export async function recordOutboundOptOut(db, {
  voterId,
  phoneNumbers = [],
  sourceAttemptId = null,
  source = 'SARVAM_WEBHOOK'
}) {
  const canonicalVoter = voterIdentity(voterId);
  if (!Array.isArray(phoneNumbers)) {
    throw consentError('Opt-out phone snapshots must be an array', 400, 'OUTBOUND_OPTOUT_PHONES_INVALID');
  }
  const canonicalPhones = [...new Set(phoneNumbers.map(normalizeOutboundMobile).filter(Boolean))];
  const entries = identifiers(canonicalVoter, canonicalPhones);
  const auditSource = boundedAuditValue(source, 80, 'source');
  const auditAttempt = boundedAuditValue(sourceAttemptId, 200, 'attempt', true);
  await lockIdentifiers(db, entries);
  let inserted = 0;
  for (const entry of entries) {
    const result = await db.query(`
      INSERT INTO public.outbound_contact_suppressions_v1
        (identifier_kind, identifier_hash, source, source_attempt_id)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (identifier_kind, identifier_hash) DO NOTHING
      RETURNING identifier_kind
    `, [entry.kind, entry.hash, auditSource, auditAttempt]);
    inserted += Number(result.rowCount ?? result.rows?.length ?? 0);
  }
  return { inserted, identifiers: entries.length, phoneIdentifiers: canonicalPhones.length };
}

/**
 * Callback-side sticky-state lookup, NOT a new submission permission check.
 * The caller owns an open transaction; locks remain held through its outcome
 * write. Invalid/missing phone snapshots are ignored, not treated as opt-outs.
 * This distinguishes an actual recorded opt-out from a fail-closed launch veto.
 */
export async function hasRecordedOutboundOptOut(db, { voterId, phoneNumbers = [] }) {
  const canonicalVoter = voterIdentity(voterId);
  if (!Array.isArray(phoneNumbers)) {
    throw consentError('Opt-out phone snapshots must be an array', 400, 'OUTBOUND_OPTOUT_PHONES_INVALID');
  }
  const canonicalPhones = [...new Set(phoneNumbers.map(normalizeOutboundMobile).filter(Boolean))];
  const entries = identifiers(canonicalVoter, canonicalPhones);
  await lockIdentifiers(db, entries);
  const voterHash = entries.find((entry) => entry.kind === 'VOTER').hash;
  const phoneHashes = entries.filter((entry) => entry.kind === 'PHONE').map((entry) => entry.hash);
  const result = await db.query(`
    SELECT EXISTS (
      SELECT 1 FROM public.outbound_contact_suppressions_v1
      WHERE (identifier_kind = 'VOTER' AND identifier_hash = $1)
         OR (identifier_kind = 'PHONE' AND identifier_hash = ANY($2::text[]))
    ) AS suppressed
  `, [voterHash, phoneHashes]);
  const suppressed = result.rows?.[0]?.suppressed;
  if (typeof suppressed !== 'boolean') {
    throw consentError('Recorded outbound opt-out state could not be verified', 503, 'OUTBOUND_CONSENT_UNAVAILABLE');
  }
  return suppressed;
}

async function runtimeGetDb() {
  const { getDb } = await import('../db/postgres.js');
  return getDb();
}

/**
 * Final provider-submission boundary. The transaction holds destination locks
 * through submit(), ordering it against opt-out commits. A provider submission
 * that wins the lock before opt-out cannot subsequently be undone by this code.
 * Tests inject getDb and a provider-free submit callback.
 */
export async function withOutboundConsentGuard({ voterId, phoneNumber }, submit, { getDb = runtimeGetDb } = {}) {
  const canonicalVoter = voterIdentity(voterId);
  const canonicalPhone = normalizeOutboundMobile(phoneNumber);
  if (!canonicalPhone) {
    throw consentError('A valid Indian mobile is required before outbound contact', 409, 'OUTBOUND_PHONE_INVALID');
  }
  if (typeof submit !== 'function') throw new TypeError('An outbound submission function is required');
  const pool = await getDb();
  const db = await pool.connect();
  let began = false;
  let submissionReturned = false;
  try {
    await db.query('BEGIN');
    began = true;
    await lockIdentifiers(db, identifiers(canonicalVoter, [canonicalPhone]));
    const result = await db.query(`
      SELECT public.outbound_contact_is_suppressed_v1($1::uuid, $2::text) AS suppressed
    `, [canonicalVoter, canonicalPhone]);
    const suppressed = result.rows?.[0]?.suppressed;
    if (suppressed !== false) {
      if (suppressed === true) {
        throw consentError('This contact has opted out of outbound calls', 409, 'OUTBOUND_CONTACT_SUPPRESSED');
      }
      throw consentError('Outbound contact permission could not be verified', 503, 'OUTBOUND_CONSENT_UNAVAILABLE');
    }
    const response = await submit();
    submissionReturned = true;
    await db.query('COMMIT');
    began = false;
    return response;
  } catch (error) {
    if (began) {
      try { await db.query('ROLLBACK'); } catch { /* Connection release still runs. */ }
    }
    if (submissionReturned && error.providerSubmissionMayHaveOccurred !== true) {
      const uncertain = consentError('Provider submission may have succeeded; verify its result before retrying',
        503, 'OUTBOUND_SUBMISSION_STATE_UNCERTAIN');
      uncertain.providerSubmissionMayHaveOccurred = true;
      uncertain.cause = error;
      throw uncertain;
    }
    throw error;
  } finally {
    db.release();
  }
}
