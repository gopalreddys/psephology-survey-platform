import { getDb } from "./postgres.js";

const apply = process.argv.includes("--apply");
const pool = await getDb();
const db = await pool.connect();

try {
  const result = await db.query(`
    SELECT
      run.id,
      run.run_number,
      run.run_name,
      run.status,
      COUNT(contact.id)::int AS contacts,
      COUNT(contact.id) FILTER (
        WHERE contact.attempt_status NOT IN ('COMPLETED', 'FAILED')
      )::int AS active_contacts,
      COUNT(contact.id) FILTER (
        WHERE contact.final_status IN (
          'SUCCESS_PULSE',
          'SUCCESS_COMPLETE',
          'SUCCESS_SUBSTANTIAL'
        )
      )::int AS successful,
      COUNT(contact.id) FILTER (
        WHERE contact.retry_eligible = TRUE
          AND contact.retry_exhausted = FALSE
      )::int AS retry_eligible
    FROM campaign_runs run
    JOIN campaign_run_contacts contact
      ON contact.run_id = run.id
    WHERE run.status IN ('READY', 'RUNNING')
    GROUP BY run.id, run.run_number, run.run_name, run.status
    HAVING COUNT(contact.id) > 0
       AND COUNT(contact.id) FILTER (
         WHERE contact.attempt_status NOT IN ('COMPLETED', 'FAILED')
       ) = 0
    ORDER BY run.created_at
  `);

  console.log("Resolved Runs eligible for finalization:");
  console.table(result.rows);

  if (!apply) {
    console.log("Dry run only. Re-run with --apply to finalize these Runs.");
    process.exit(0);
  }

  await db.query("BEGIN");

  for (const run of result.rows) {
    await db.query(
      "SELECT pg_advisory_xact_lock(hashtext($1))",
      [String(run.id)]
    );

    const currentState = await db.query(
      `
        SELECT COUNT(*) FILTER (
          WHERE attempt_status NOT IN ('COMPLETED', 'FAILED')
        )::int AS active_contacts
        FROM campaign_run_contacts
        WHERE run_id = $1
      `,
      [run.id]
    );

    if (Number(currentState.rows[0]?.active_contacts || 0) !== 0) {
      throw new Error(`Run ${run.id} became active during finalization`);
    }

    await db.query(
      `
        UPDATE campaign_run_cycles
        SET status = 'COMPLETED'
        WHERE run_id = $1
          AND status IN ('READY', 'RUNNING')
      `,
      [run.id]
    );

    await db.query(
      `
        UPDATE campaign_runs
        SET status = 'COMPLETED',
            updated_at = now()
        WHERE id = $1
          AND status IN ('READY', 'RUNNING')
      `,
      [run.id]
    );
  }

  await db.query("COMMIT");
  console.log(`Finalized ${result.rowCount} resolved Run(s).`);
} catch (error) {
  try {
    await db.query("ROLLBACK");
  } catch {
    // No transaction may have been started during a failed dry-run query.
  }
  console.error("Run finalization failed:", error);
  process.exitCode = 1;
} finally {
  db.release();
}
