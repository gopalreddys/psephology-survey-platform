import { getDb } from "./postgres.js";
import { reconcileRunLifecycle } from "../repositories/run-lifecycle.repository.js";

const apply = process.argv.includes("--apply");
const pool = await getDb();
const db = await pool.connect();

try {
  const result = await db.query(
    `
      SELECT
        run.id,
        run.iteration_id,
        run.run_number,
        run.run_name,
        run.status,
        COUNT(DISTINCT contact.id)::int AS contacts,
        COUNT(DISTINCT contact.id) FILTER (
          WHERE COALESCE(contact.attempt_status, 'PENDING')
            NOT IN ('COMPLETED', 'FAILED')
        )::int AS pending_contacts,
        COUNT(DISTINCT execution.id) FILTER (
          WHERE COALESCE(execution.status, 'PENDING')
            NOT IN ('COMPLETED', 'FAILED', 'CANCELLED')
        )::int AS active_executions
      FROM campaign_runs run
      LEFT JOIN campaign_run_contacts contact
        ON contact.run_id = run.id
      LEFT JOIN call_executions execution
        ON execution.run_id = run.id
      WHERE run.status NOT IN ('COMPLETED', 'FAILED', 'CANCELLED', 'ARCHIVED')
      GROUP BY run.id, run.iteration_id, run.run_number, run.run_name, run.status
      ORDER BY run.created_at
    `
  );

  console.log("Open Run lifecycle candidates:");
  console.table(result.rows);

  if (!apply) {
    console.log("Dry run only. Re-run with --apply to reconcile these Runs.");
    process.exit(0);
  }

  const reconciled = [];

  for (const run of result.rows) {
    await db.query("BEGIN");
    try {
      reconciled.push(await reconcileRunLifecycle(db, run.id, {
        source: "MANUAL_RECONCILIATION"
      }));
      await db.query("COMMIT");
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    }
  }

  console.log("Lifecycle reconciliation results:");
  console.table(reconciled);
} catch (error) {
  console.error("Run lifecycle reconciliation failed:", error);
  process.exitCode = 1;
} finally {
  db.release();
}
