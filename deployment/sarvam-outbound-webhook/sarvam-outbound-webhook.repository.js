import { createHash } from "node:crypto";

import { getDb } from "../db/postgres.js";

const TECHNICAL_VARIABLES = new Set([
  "agent_code",
  "agent_style_context",
  "analytics_excluded",
  "attempt_cycle_id",
  "demo_call_id",
  "iteration_id",
  "iteration_number",
  "knowledge_context",
  "knowledge_packs",
  "max_probes",
  "preferred_language",
  "probe_context",
  "probe_set",
  "questionnaire_code",
  "questionnaire_context",
  "research_context",
  "run_contact_id",
  "run_id",
  "source",
  "study_id",
  "user_name",
  "voice_code",
  "voter_id",
  "voter_profession",
  "voter_qualification"
]);

function normalizeStatus(status) {
  const value = String(status || "").trim().toLowerCase();

  if (["connected", "no_answer", "busy", "failed"].includes(value)) {
    return value;
  }

  const error = new Error("Unsupported Sarvam outbound status");
  error.statusCode = 400;
  error.code = "INVALID_SARVAM_STATUS";
  throw error;
}

function scalarText(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (["number", "boolean"].includes(typeof value)) return String(value);
  return JSON.stringify(value);
}

function metadataFrom(payload) {
  return payload?.webhook_config?.metadata || {};
}

function uuidOrNull(value) {
  const text = String(value || "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)
    ? text
    : null;
}

function payloadForStorage(payload) {
  const stored = JSON.parse(JSON.stringify(payload));

  if (stored?.webhook_config?.url) {
    stored.webhook_config.url = "[REDACTED]";
  }

  return stored;
}

function eventHash(payload) {
  return createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex");
}

async function completeThreeRunIteration(db, iterationId) {
  if (!iterationId) return false;

  const stateResult = await db.query(
    `
      SELECT
        COUNT(DISTINCT run.run_number) FILTER (
          WHERE run.run_number BETWEEN 1 AND 3
            AND run.status IN ('COMPLETED', 'FAILED', 'CANCELLED', 'ARCHIVED')
        )::int AS closed_policy_runs,
        COUNT(*) FILTER (
          WHERE run.status NOT IN ('COMPLETED', 'FAILED', 'CANCELLED', 'ARCHIVED')
        )::int AS open_runs,
        EXISTS (
          SELECT 1
          FROM campaign_run_contacts contact
          JOIN campaign_runs contact_run ON contact_run.id = contact.run_id
          WHERE contact_run.iteration_id = $1
            AND contact.attempt_status NOT IN ('COMPLETED', 'FAILED')
        ) AS has_pending_contacts
      FROM campaign_runs run
      WHERE run.iteration_id = $1
    `,
    [iterationId]
  );

  const state = stateResult.rows[0] || {};
  const cycleComplete =
    Number(state.closed_policy_runs || 0) === 3 &&
    Number(state.open_runs || 0) === 0 &&
    state.has_pending_contacts !== true;

  if (!cycleComplete) return false;

  await db.query(
    `
      UPDATE campaign_run_contacts contact
      SET retry_eligible = FALSE,
          retry_exhausted = TRUE,
          final_status = CASE
            WHEN COALESCE(contact.final_status, 'PENDING') = 'PENDING'
              THEN 'RETRY_EXHAUSTED'
            ELSE contact.final_status
          END,
          completion_reason = COALESCE(
            contact.completion_reason,
            'Three-Run retry policy completed'
          )
      FROM campaign_runs run
      WHERE run.id = contact.run_id
        AND run.iteration_id = $1
        AND run.run_number = 3
        AND contact.retry_eligible = TRUE
        AND contact.retry_exhausted = FALSE
    `,
    [iterationId]
  );

  await db.query(
    `
      UPDATE campaign_iteration_links
      SET status = 'COMPLETED', updated_at = now()
      WHERE iteration_id = $1
        AND status <> 'COMPLETED'
    `,
    [iterationId]
  );
  await db.query(
    `
      UPDATE program_iterations
      SET status = 'COMPLETED', updated_at = now()
      WHERE id = $1
        AND status <> 'COMPLETED'
    `,
    [iterationId]
  );

  return true;
}

export async function recordSarvamOutboundResult(payload) {
  const attemptId = String(payload?.attempt_id || "").trim();

  if (!attemptId) {
    const error = new Error("attempt_id is required");
    error.statusCode = 400;
    error.code = "ATTEMPT_ID_REQUIRED";
    throw error;
  }

  const providerStatus = normalizeStatus(payload.status);
  const metadata = metadataFrom(payload);
  const fingerprint = eventHash(payload);
  const storedPayload = payloadForStorage(payload);
  const pool = await getDb();
  const db = await pool.connect();

  try {
    await db.query("BEGIN");
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [attemptId]);

    const existingEvent = await db.query(
      `
        SELECT id, delivery_status
        FROM sarvam_outbound_webhook_events
        WHERE event_hash = $1
      `,
      [fingerprint]
    );

    if (existingEvent.rows[0]?.delivery_status === "PROCESSED") {
      await db.query("COMMIT");
      return { duplicate: true, attemptId };
    }

    const eventResult = existingEvent.rows[0]
      ? existingEvent
      : await db.query(
          `
            INSERT INTO sarvam_outbound_webhook_events (
              attempt_id,
              event_hash,
              raw_payload
            )
            VALUES ($1, $2, $3::jsonb)
            RETURNING id, delivery_status
          `,
          [attemptId, fingerprint, JSON.stringify(storedPayload)]
        );

    const eventId = eventResult.rows[0].id;

    const executionResult = await db.query(
      `
        SELECT
          execution.*,
          run.iteration_id,
          iteration.study_id,
          voter.is_demo_contact
        FROM call_executions execution
        LEFT JOIN campaign_runs run ON run.id = execution.run_id
        LEFT JOIN program_iterations iteration ON iteration.id = run.iteration_id
        LEFT JOIN voter_master voter ON voter.id = execution.voter_id
        WHERE execution.provider_attempt_id = $1
           OR (
             $2::uuid IS NOT NULL
             AND execution.id = $2::uuid
           )
        ORDER BY
          CASE WHEN execution.provider_attempt_id = $1 THEN 0 ELSE 1 END,
          execution.created_at DESC
        LIMIT 1
        FOR UPDATE OF execution
      `,
      [
        attemptId,
        uuidOrNull(metadata.call_execution_id || metadata.execution_id)
      ]
    );

    const execution = executionResult.rows[0];

    if (!execution) {
      await db.query(
        `
          UPDATE sarvam_outbound_webhook_events
          SET delivery_status = 'UNMATCHED',
              error_message = 'No matching call execution'
          WHERE id = $1
        `,
        [eventId]
      );
      await db.query("COMMIT");
      return { matched: false, attemptId };
    }

    // Serialize callbacks belonging to the same Run. Under PostgreSQL's
    // READ COMMITTED isolation, the callback that obtains this lock last will
    // see every earlier committed contact result and can safely finalize the
    // Run without a last-callback race.
    await db.query(
      "SELECT pg_advisory_xact_lock(hashtext($1))",
      [String(execution.run_id)]
    );

    const successful = providerStatus === "connected";
    const retryEligible = !successful;
    const normalizedStatus = successful
      ? "COMPLETED"
      : providerStatus.toUpperCase();
    const executionStatus = successful ? "COMPLETED" : "FAILED";
    const transcript = Array.isArray(payload.interaction_transcript)
      ? payload.interaction_transcript
      : [];
    const finalVariables =
      payload.final_agent_variables &&
      typeof payload.final_agent_variables === "object"
        ? payload.final_agent_variables
        : {};

    await db.query(
      `
        UPDATE call_executions
        SET provider_attempt_id = COALESCE(provider_attempt_id, $2),
            status = $3,
            response_payload = $4::jsonb,
            callback_payload = $4::jsonb,
            callback_received_at = now(),
            error_message = $5,
            completed_at = now(),
            updated_at = now()
        WHERE id = $1
      `,
      [
        execution.id,
        attemptId,
        executionStatus,
        JSON.stringify(storedPayload),
        payload.failure_reason || null
      ]
    );

    let callResult = await db.query(
      `
        UPDATE calls
        SET interaction_id = $2,
            connectivity_status = $3,
            failure_reason = $4,
            duration_seconds = $5,
            num_messages = $6,
            channel_direction = 'OUTBOUND',
            agent_variables = $7::jsonb,
            raw_payload = $8::jsonb,
            iteration_id = COALESCE(iteration_id, $9::uuid),
            run_id = $10,
            voter_id = $11,
            attempt_number = $12,
            normalized_status = $13,
            retry_eligible = $14,
            analytical_snapshot = $15::jsonb,
            run_contact_id = $16,
            attempt_cycle_id = $17,
            agent_profile_id = $18,
            voice_profile_id = $19,
            interaction_transcript = $20::jsonb,
            response_variables = $7::jsonb,
            updated_at = now()
        WHERE attempt_id = $1
        RETURNING id
      `,
      [
        attemptId,
        payload.interaction_id || null,
        providerStatus,
        payload.failure_reason || null,
        payload.duration ?? null,
        transcript.length,
        JSON.stringify(finalVariables),
        JSON.stringify(storedPayload),
        execution.iteration_id || uuidOrNull(metadata.iteration_id),
        execution.run_id,
        execution.voter_id,
        execution.attempt_number,
        normalizedStatus,
        retryEligible,
        JSON.stringify({
          status: providerStatus,
          duration: payload.duration ?? null,
          channel_info: payload.channel_info || null,
          final_agent_variables: finalVariables,
          transcript_turns: transcript.length
        }),
        execution.run_contact_id,
        execution.attempt_cycle_id,
        execution.agent_profile_id,
        execution.voice_profile_id,
        JSON.stringify(transcript)
      ]
    );

    if (!callResult.rows[0]) {
      callResult = await db.query(
        `
          INSERT INTO calls (
            id,
            attempt_id,
            interaction_id,
            connectivity_status,
            failure_reason,
            duration_seconds,
            num_messages,
            channel_direction,
            agent_variables,
            raw_payload,
            first_seen_at,
            updated_at,
            iteration_id,
            run_id,
            voter_id,
            attempt_number,
            normalized_status,
            retry_eligible,
            analytical_snapshot,
            run_contact_id,
            attempt_cycle_id,
            agent_profile_id,
            voice_profile_id,
            interaction_transcript,
            response_variables
          )
          VALUES (
            gen_random_uuid(), $1, $2, $3, $4, $5, $6, 'OUTBOUND', $7::jsonb, $8::jsonb,
            now(), now(), $9::uuid, $10, $11, $12, $13, $14, $15::jsonb,
            $16, $17, $18, $19, $20::jsonb, $7::jsonb
          )
          RETURNING id
        `,
        [
          attemptId,
          payload.interaction_id || null,
          providerStatus,
          payload.failure_reason || null,
          payload.duration ?? null,
          transcript.length,
          JSON.stringify(finalVariables),
          JSON.stringify(storedPayload),
          execution.iteration_id || uuidOrNull(metadata.iteration_id),
          execution.run_id,
          execution.voter_id,
          execution.attempt_number,
          normalizedStatus,
          retryEligible,
          JSON.stringify({
            status: providerStatus,
            duration: payload.duration ?? null,
            channel_info: payload.channel_info || null,
            final_agent_variables: finalVariables,
            transcript_turns: transcript.length
          }),
          execution.run_contact_id,
          execution.attempt_cycle_id,
          execution.agent_profile_id,
          execution.voice_profile_id,
          JSON.stringify(transcript)
        ]
      );
    }

    const callId = callResult.rows[0].id;

    await db.query(
      `
        UPDATE calls
        SET study_id = COALESCE(study_id, $2::uuid)
        WHERE id = $1
      `,
      [callId, execution.study_id || uuidOrNull(metadata.study_id)]
    );

    await db.query(
      `
        UPDATE campaign_run_contacts
        SET attempt_status = $2,
            final_status = $3,
            retry_eligible = $4,
            retry_exhausted = CASE WHEN $4 THEN retry_exhausted ELSE false END,
            completed_at = CASE WHEN $5 THEN now() ELSE completed_at END,
            successful_call_id = CASE WHEN $5 THEN $6 ELSE successful_call_id END,
            final_outcome = $7,
            completion_reason = $8
        WHERE id = $1
      `,
      [
        execution.run_contact_id,
        successful ? "COMPLETED" : "FAILED",
        successful ? "SUCCESS_COMPLETE" : "PENDING",
        retryEligible,
        successful,
        callId,
        normalizedStatus,
        payload.failure_reason || providerStatus
      ]
    );

    const analyticsExcluded = Boolean(execution.is_demo_contact) ||
      String(metadata.analytics_excluded || "").toLowerCase() === "true";

    if (!analyticsExcluded) {
      for (const [key, value] of Object.entries(finalVariables)) {
        if (TECHNICAL_VARIABLES.has(key)) continue;

        await db.query(
          `
            INSERT INTO survey_responses (
              id,
              interaction_id,
              study_id,
              iteration_id,
              run_id,
              voter_id,
              response_text,
              response_value,
              confidence,
              captured_at,
              created_at,
              source_call_id,
              source_variable_key,
              response_source
            )
            VALUES (
              gen_random_uuid(), $1, $2::uuid, $3::uuid, $4, $5, $6, $7::jsonb,
              NULL, now(), now(), $8, $9, 'SARVAM_FINAL_AGENT_VARIABLE'
            )
            ON CONFLICT (source_call_id, source_variable_key)
              WHERE source_call_id IS NOT NULL
                AND source_variable_key IS NOT NULL
            DO UPDATE SET
              interaction_id = EXCLUDED.interaction_id,
              response_text = EXCLUDED.response_text,
              response_value = EXCLUDED.response_value,
              captured_at = EXCLUDED.captured_at
          `,
          [
            payload.interaction_id || null,
            execution.study_id || uuidOrNull(metadata.study_id),
            execution.iteration_id || uuidOrNull(metadata.iteration_id),
            execution.run_id,
            execution.voter_id,
            scalarText(value),
            JSON.stringify({ variable: key, value }),
            callId,
            key
          ]
        );
      }
    }

    const runStateResult = await db.query(
      `
        SELECT
          COUNT(*)::int AS total_contacts,
          COUNT(*) FILTER (
            WHERE attempt_status NOT IN ('COMPLETED', 'FAILED')
          )::int AS active_contacts
        FROM campaign_run_contacts
        WHERE run_id = $1
      `,
      [execution.run_id]
    );

    const runState = runStateResult.rows[0];
    const runFinalized =
      Number(runState?.total_contacts || 0) > 0 &&
      Number(runState?.active_contacts || 0) === 0;

    let iterationFinalized = false;

    if (runFinalized) {
      await db.query(
        `
          UPDATE campaign_run_cycles
          SET status = 'COMPLETED'
          WHERE id = $1
            AND status IN ('READY', 'RUNNING')
        `,
        [execution.attempt_cycle_id]
      );

      await db.query(
        `
          UPDATE campaign_runs
          SET status = 'COMPLETED',
              updated_at = now()
          WHERE id = $1
            AND status IN ('READY', 'RUNNING')
        `,
        [execution.run_id]
      );

      iterationFinalized = await completeThreeRunIteration(
        db,
        execution.iteration_id
      );
    }

    await db.query(
      `
        UPDATE sarvam_outbound_webhook_events
        SET delivery_status = 'PROCESSED',
            processed_at = now(),
            error_message = NULL
        WHERE id = $1
      `,
      [eventId]
    );

    await db.query("COMMIT");

    return {
      matched: true,
      duplicate: false,
      attemptId,
      callId,
      status: normalizedStatus,
      runFinalized,
      iterationFinalized,
      transcriptTurns: transcript.length,
      responseVariables: Object.keys(finalVariables)
        .filter((key) => !TECHNICAL_VARIABLES.has(key)).length
    };
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}
