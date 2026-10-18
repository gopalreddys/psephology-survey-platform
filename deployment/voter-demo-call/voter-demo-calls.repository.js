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
          voter_master.id,
          voter_master.full_name,
          voter_master.phone_number,
          voter_master.preferred_language,
          voter_master.occupation,
          voter_master.qualification,
          voter_master.age,
          voter_master.gender,
          voter_master.mandal_name_source,
          voter_master.assembly_constituency_name,
          geography.name AS geography_name,
          geography.geo_type AS geography_type,
          parent_geography.name AS parent_geography_name,
          parent_geography.geo_type AS parent_geography_type,
          voter_master.contact_status,
          public.outbound_contact_is_suppressed_v1(voter_master.id, voter_master.phone_number) AS outbound_suppressed,
          voter_master.is_active,
          voter_master.is_demo_contact
        FROM voter_master
        LEFT JOIN geo_units geography
          ON geography.id = voter_master.geo_unit_id
        LEFT JOIN geo_units parent_geography
          ON parent_geography.id = geography.parent_id
        WHERE voter_master.id = $1
        FOR UPDATE OF voter_master
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

    if (voter.outbound_suppressed !== false) {
      throw repositoryError("This contact is not available for outbound calls", 409, "OUTBOUND_CONTACT_SUPPRESSED");
    }

    if (!voter.is_demo_contact) {
      throw repositoryError(
        "Demo calls are restricted to explicitly approved demo voters",
        403,
        "VOTER_NOT_APPROVED_FOR_DEMO"
      );
    }

    if (String(voter.qualification || "").trim()) {
      throw repositoryError(
        "Demo calls are restricted to approved demo records without a qualification",
        403,
        "VOTER_NOT_DEMO_PROFILE"
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
          preferred_language_snapshot,
          submitted_phone_snapshot
        )
        VALUES ($1, $2, $3, TRUE, TRUE, $4, public.outbound_mobile_normalize_v1($5))
        RETURNING id, status, created_at
      `,
      [
        voterId,
        requestedBy,
        idempotencyKey,
        voter.preferred_language || null,
        voter.phone_number
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
        AND NOT public.outbound_contact_is_suppressed_v1(id, phone_number)
        AND phone_number IS NOT NULL
        AND length(trim(phone_number)) > 0
        AND (qualification IS NULL OR length(trim(qualification)) = 0)
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

export async function recordVoterDemoCallOutcome(db, {
  demoCallId,
  providerCallId,
  providerStatus,
  interactionId = null,
  disposition = null,
  goalStatus = null,
  durationSeconds = null,
  transcriptTurns = 0,
  finalAgentVariables = {},
  callbackPayload = {},
  failureReason = null
}) {
  const operationalStatus = providerStatus === "connected"
    ? "COMPLETED"
    : "FAILED";
  const result = await db.query(
    `
      UPDATE voter_demo_calls
      SET
        status = $3,
        provider_call_id = COALESCE(provider_call_id, $2),
        provider_status = $4,
        interaction_id = $5,
        disposition = $6,
        goal_status = $7,
        duration_seconds = $8,
        transcript_turns = $9,
        final_agent_variables = $10::jsonb,
        callback_payload = $11::jsonb,
        callback_received_at = now(),
        completed_at = now(),
        error_code = CASE WHEN $3 = 'FAILED' THEN 'PROVIDER_CALL_FAILED' ELSE NULL END,
        error_message = CASE WHEN $3 = 'FAILED' THEN $12 ELSE NULL END,
        updated_at = now()
      WHERE $2::text IS NOT NULL AND (
        ($1::uuid IS NOT NULL AND id = $1::uuid AND (provider_call_id IS NULL OR provider_call_id = $2))
        OR ($1::uuid IS NULL AND provider_call_id = $2)
      )
      RETURNING id, voter_id, status, submitted_phone_snapshot, provider_call_id, disposition, goal_status,
        callback_received_at
    `,
    [
      demoCallId,
      providerCallId,
      operationalStatus,
      providerStatus,
      interactionId,
      disposition,
      goalStatus,
      durationSeconds,
      transcriptTurns,
      JSON.stringify(finalAgentVariables),
      JSON.stringify(callbackPayload),
      failureReason
    ]
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
        demo.provider_status,
        demo.interaction_id,
        demo.disposition,
        demo.goal_status,
        demo.duration_seconds,
        demo.transcript_turns,
        demo.callback_received_at,
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
