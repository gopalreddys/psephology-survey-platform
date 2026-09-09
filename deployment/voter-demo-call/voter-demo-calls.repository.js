import { getDb } from "../db/postgres.js";

const RECENT_REQUEST_STATUSES = [
  "QUEUED",
  "SUBMITTING",
  "SUBMITTED",
  "FAILED"
];

function repositoryError(message, statusCode, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

export async function reserveVoterDemoCall({
  voterId,
  requestedBy,
  idempotencyKey
}) {
  const pool = await getDb();
  const db = await pool.connect();

  try {
    await db.query("BEGIN");

    const repeatedRequest = await db.query(
      `
        SELECT id, status, provider_call_id
        FROM voter_demo_calls
        WHERE idempotency_key = $1
      `,
      [idempotencyKey]
    );

    if (repeatedRequest.rows[0]) {
      await db.query("COMMIT");
      return {
        request: repeatedRequest.rows[0],
        voter: null,
        repeated: true
      };
    }

    await db.query(
      "SELECT pg_advisory_xact_lock(hashtext($1))",
      [voterId]
    );

    const voterResult = await db.query(
      `
        SELECT
          id,
          full_name,
          phone_number,
          preferred_language,
          occupation,
          qualification,
          contact_status,
          is_active,
          is_demo_contact
        FROM voter_master
        WHERE id = $1
        FOR UPDATE
      `,
      [voterId]
    );

    const voter = voterResult.rows[0];

    if (!voter) {
      throw repositoryError("Voter record not found", 404, "VOTER_NOT_FOUND");
    }

    if (!voter.is_active || voter.contact_status !== "ACTIVE") {
      throw repositoryError(
        "Only an active voter contact can receive a demo call",
        409,
        "VOTER_NOT_ACTIVE"
      );
    }

    if (!voter.is_demo_contact) {
      throw repositoryError(
        "Demo calls are restricted to explicitly approved demo voters",
        403,
        "VOTER_NOT_APPROVED_FOR_DEMO"
      );
    }

    if (!String(voter.phone_number || "").trim()) {
      throw repositoryError(
        "The selected voter does not have a phone number",
        409,
        "PHONE_NOT_AVAILABLE"
      );
    }

    const activeRequest = await db.query(
      `
        SELECT id, status
        FROM voter_demo_calls
        WHERE voter_id = $1
          AND status = ANY($2::text[])
          AND created_at > now() - interval '2 minutes'
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [voterId, RECENT_REQUEST_STATUSES]
    );

    if (activeRequest.rows[0]) {
      throw repositoryError(
        "A demo call for this voter was already submitted recently. Wait two minutes before trying again.",
        409,
        "DEMO_CALL_COOLDOWN"
      );
    }

    const insertResult = await db.query(
      `
        INSERT INTO voter_demo_calls (
          voter_id,
          requested_by,
          idempotency_key,
          consent_confirmed,
          analytics_excluded,
          preferred_language_snapshot
        )
        VALUES ($1, $2, $3, TRUE, TRUE, $4)
        RETURNING id, status, created_at
      `,
      [
        voterId,
        requestedBy,
        idempotencyKey,
        voter.preferred_language || null
      ]
    );

    await db.query("COMMIT");

    return {
      request: insertResult.rows[0],
      voter,
      repeated: false
    };
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}

export async function listVoterDemoContactIds() {
  const db = await getDb();

  const result = await db.query(
    `
      SELECT id
      FROM voter_master
      WHERE is_demo_contact = TRUE
        AND is_active = TRUE
        AND contact_status = 'ACTIVE'
        AND phone_number IS NOT NULL
        AND length(trim(phone_number)) > 0
      ORDER BY id
    `
  );

  return result.rows.map((row) => row.id);
}

export async function updateVoterDemoCall(demoCallId, {
  status,
  providerCallId = null,
  errorCode = null,
  errorMessage = null
}) {
  const db = await getDb();

  const result = await db.query(
    `
      UPDATE voter_demo_calls
      SET
        status = $2,
        provider_call_id = COALESCE($3, provider_call_id),
        error_code = $4,
        error_message = $5,
        submitted_at = CASE
          WHEN $2 = 'SUBMITTED' THEN COALESCE(submitted_at, now())
          ELSE submitted_at
        END,
        completed_at = CASE
          WHEN $2 IN ('COMPLETED', 'FAILED', 'CANCELLED') THEN now()
          ELSE completed_at
        END,
        updated_at = now()
      WHERE id = $1
      RETURNING id, status, provider_call_id, submitted_at, completed_at
    `,
    [demoCallId, status, providerCallId, errorCode, errorMessage]
  );

  return result.rows[0] || null;
}

export async function listVoterDemoCalls(voterId, limit = 10) {
  const db = await getDb();
  const safeLimit = Math.min(Math.max(Number(limit) || 10, 1), 25);

  const result = await db.query(
    `
      SELECT
        demo.id,
        demo.status,
        demo.provider_call_id,
        demo.preferred_language_snapshot,
        demo.submitted_at,
        demo.completed_at,
        demo.created_at,
        requester.full_name AS requested_by_name
      FROM voter_demo_calls demo
      LEFT JOIN users requester ON requester.id = demo.requested_by
      WHERE demo.voter_id = $1
      ORDER BY demo.created_at DESC
      LIMIT $2
    `,
    [voterId, safeLimit]
  );

  return result.rows;
}
