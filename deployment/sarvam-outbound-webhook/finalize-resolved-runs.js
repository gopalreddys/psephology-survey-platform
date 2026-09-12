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

  const iterationResult = await db.query(`
    SELECT run.iteration_id
    FROM campaign_runs run
    WHERE EXISTS (
      SELECT 1
      FROM campaign_iteration_links link
      WHERE link.iteration_id = run.iteration_id
        AND link.status <> 'COMPLETED'
    ) OR EXISTS (
      SELECT 1
      FROM program_iterations iteration
      WHERE iteration.id = run.iteration_id
        AND iteration.status <> 'COMPLETED'
    )
    GROUP BY run.iteration_id
    HAVING COUNT(DISTINCT run.run_number) FILTER (
      WHERE run.run_number BETWEEN 1 AND 3
        AND run.status IN ('COMPLETED', 'FAILED', 'CANCELLED', 'ARCHIVED')
    ) = 3
      AND COUNT(*) FILTER (
        WHERE run.status NOT IN ('COMPLETED', 'FAILED', 'CANCELLED', 'ARCHIVED')
      ) = 0
      AND NOT EXISTS (
        SELECT 1
        FROM campaign_run_contacts pending_contact
        JOIN campaign_runs pending_run ON pending_run.id = pending_contact.run_id
        WHERE pending_run.iteration_id = run.iteration_id
          AND pending_contact.attempt_status NOT IN ('COMPLETED', 'FAILED')
      )
  `);

  for (const iteration of iterationResult.rows) {
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
      [iteration.iteration_id]
    );
    await db.query(
      `
        UPDATE campaign_iteration_links
        SET status = 'COMPLETED', updated_at = now()
        WHERE iteration_id = $1
      `,
      [iteration.iteration_id]
    );
    await db.query(
      `
        UPDATE program_iterations
        SET status = 'COMPLETED', updated_at = now()
        WHERE id = $1
      `,
      [iteration.iteration_id]
    );
  }

  await db.query("COMMIT");
  console.log(`Finalized ${result.rowCount} resolved Run(s).`);
  console.log(`Completed ${iterationResult.rowCount} three-Run Iteration(s).`);
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
