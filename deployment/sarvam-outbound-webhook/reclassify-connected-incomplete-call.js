import { getDb } from "../db/postgres.js";
import {
  classifyCallCompletion,
  DEFAULT_TECHNICAL_VARIABLES
} from "../repositories/call-completion-policy.js";

const attemptId = String(
  process.argv.slice(2).find((argument) => !argument.startsWith("--")) || ""
).trim();
const apply = process.argv.includes("--apply");

if (!attemptId) {
  throw new Error(
    "Usage: node src/db/reclassify-connected-incomplete-call.js <provider-attempt-id> [--apply]"
  );
}

const pool = await getDb();
const db = await pool.connect();

try {
  await db.query("BEGIN");
  await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [attemptId]);

  const result = await db.query(
    `
      SELECT
        call.id AS call_id,
        call.attempt_id,
        call.connectivity_status,
        call.response_variables,
        call.normalized_status,
        call.retry_eligible AS call_retry_eligible,
        execution.id AS execution_id,
        execution.run_id,
        execution.run_contact_id,
        run.run_number,
        run.status AS run_status,
        contact.attempt_status,
        contact.final_status,
        contact.retry_eligible,
        contact.completion_reason,
        contact.successful_call_id
      FROM calls call
      JOIN call_executions execution
        ON execution.provider_attempt_id = call.attempt_id
      JOIN campaign_runs run ON run.id = execution.run_id
      JOIN campaign_run_contacts contact
        ON contact.id = execution.run_contact_id
      WHERE call.attempt_id = $1
      ORDER BY call.updated_at DESC
      LIMIT 1
      FOR UPDATE OF call, execution, contact
    `,
    [attemptId]
  );

  if (!result.rowCount) {
    throw new Error(`Call attempt ${attemptId} was not found`);
  }

  const row = result.rows[0];
  const completion = classifyCallCompletion({
    providerStatus: row.connectivity_status,
    finalVariables: row.response_variables || {},
    technicalVariables: DEFAULT_TECHNICAL_VARIABLES
  });

  console.table([{
    attempt_id: row.attempt_id,
    connectivity: row.connectivity_status,
    run_number: row.run_number,
    run_status: row.run_status,
    current_final_status: row.final_status,
    corrected_status: completion.finalStatus,
    corrected_reason: completion.completionReason,
    meaningful_responses: completion.meaningfulResponseKeys.length
  }]);

  if (!completion.providerConnected || completion.successful) {
    throw new Error(
      "The targeted call is not a connected, evidence-incomplete callback; refusing to modify it"
    );
  }

  if (!apply) {
    await db.query("ROLLBACK");
    console.log("Dry run only. Re-run with --apply to correct this call outcome.");
    process.exitCode = 0;
  } else {
    await db.query(
      `
        UPDATE calls
        SET normalized_status = $2,
            retry_eligible = TRUE,
            failure_reason = COALESCE(failure_reason, $3),
            updated_at = now()
        WHERE id = $1
      `,
      [row.call_id, completion.normalizedStatus, completion.completionReason]
    );
    await db.query(
      `
        UPDATE call_executions
        SET error_message = COALESCE(error_message, $2),
            updated_at = now()
        WHERE id = $1
      `,
      [row.execution_id, completion.completionReason]
    );
    await db.query(
      `
        UPDATE campaign_run_contacts
        SET attempt_status = $2,
            final_status = $3,
            retry_eligible = TRUE,
            retry_exhausted = FALSE,
            completed_at = NULL,
            successful_call_id = CASE
              WHEN successful_call_id = $4 THEN NULL
              ELSE successful_call_id
            END,
            final_outcome = $5,
            completion_reason = $6
        WHERE id = $1
      `,
      [
        row.run_contact_id,
        completion.contactAttemptStatus,
        completion.finalStatus,
        row.call_id,
        completion.normalizedStatus,
        completion.completionReason
      ]
    );

    await db.query("COMMIT");
    console.log("Connected incomplete call was reclassified and made retry eligible.");
  }
} catch (error) {
  await db.query("ROLLBACK");
  throw error;
} finally {
  db.release();
  await pool.end();
}
