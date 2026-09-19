import path from "node:path";
import { pathToFileURL } from "node:url";

const executionArgument = process.argv.find((value) =>
  value.startsWith("--execution-id=")
);
const runArgument = process.argv.find((value) =>
  value.startsWith("--run-id=")
);
const runtimeArgument = process.argv.find((value) =>
  value.startsWith("--runtime-root=")
);
const apply = process.argv.includes("--apply");
const executionId = executionArgument?.split("=")[1];
const runId = runArgument?.split("=")[1];
const runtimeRoot = path.resolve(
  runtimeArgument?.split("=")[1] || "/opt/sarvam-voice-analytics"
);

if (Boolean(executionId) === Boolean(runId)) {
  throw new Error(
    "Provide exactly one selector: --execution-id=<uuid> or --run-id=<uuid>"
  );
}

const databaseModule = pathToFileURL(
  path.join(runtimeRoot, "src/db/postgres.js")
).href;
const { getDb } = await import(databaseModule);
const pool = await getDb();
const db = await pool.connect();

try {
  await db.query("BEGIN");
  const candidateWhere = executionId
    ? "execution.id = $1"
    : "contact.run_id = $1";
  const candidateOrder = executionId
    ? ""
    : "ORDER BY execution.created_at DESC, execution.id DESC LIMIT 1";
  const candidate = await db.query(
    `
      SELECT
        execution.id AS execution_id,
        execution.execution_key,
        execution.status AS execution_status,
        execution.error_message,
        execution.provider_attempt_id,
        execution.callback_received_at,
        contact.id AS run_contact_id,
        contact.run_id,
        contact.attempt_count,
        contact.attempt_status,
        contact.final_status,
        voter.full_name
      FROM call_executions execution
      JOIN campaign_run_contacts contact
        ON contact.id = execution.run_contact_id
      JOIN voter_master voter
        ON voter.id = execution.voter_id
      WHERE ${candidateWhere}
      ${candidateOrder}
      FOR UPDATE OF execution, contact
    `,
    [executionId || runId]
  );

  if (!candidate.rowCount) {
    throw new Error(
      executionId
        ? `Execution not found: ${executionId}`
        : `No execution found for Run: ${runId}`
    );
  }

  const row = candidate.rows[0];
  console.table([row]);

  const eligible =
    row.execution_status === "FAILED" &&
    row.provider_attempt_id === null &&
    row.callback_received_at === null &&
    row.attempt_status === "PENDING" &&
    row.final_status === "PENDING" &&
    Number(row.attempt_count) === 0 &&
    /^Sarvam Instant Outbound returned 422/.test(row.error_message || "");

  if (!eligible) {
    throw new Error(
      "Execution is not an untouched provider-rejected submission; no change made"
    );
  }

  const archivedExecutionKey =
    `${row.execution_key}:provider-rejected:${row.execution_id.slice(0, 8)}`;

  if (!apply) {
    await db.query("ROLLBACK");
    console.log("Dry run only. Re-run with --apply to archive this failed key.");
    console.log({ archivedExecutionKey });
    process.exit(0);
  }

  const update = await db.query(
    `
      UPDATE call_executions
      SET execution_key = $2,
          updated_at = now()
      WHERE id = $1
        AND status = 'FAILED'
        AND provider_attempt_id IS NULL
        AND callback_received_at IS NULL
      RETURNING id, execution_key, status
    `,
    [row.execution_id, archivedExecutionKey]
  );

  if (update.rowCount !== 1) {
    throw new Error("Execution changed during recovery; no key was archived");
  }

  await db.query("COMMIT");
  console.table(update.rows);
  console.log("Provider-rejected execution preserved; pending contact can be launched again.");
} catch (error) {
  await db.query("ROLLBACK");
  console.error("Provider-rejected execution recovery failed:", error);
  process.exitCode = 1;
} finally {
  db.release();
}
