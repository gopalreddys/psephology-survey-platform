import { getDb } from "./postgres.js";
import { reconcileRunLifecycle } from "../repositories/run-lifecycle.repository.js";
import { terminalAttemptSql, activeExecutionSql } from "../repositories/operational-lifecycle-policy.js";

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
          WHERE NOT (${terminalAttemptSql()})
        )::int AS pending_contacts,
        COUNT(DISTINCT execution.id) FILTER (
          WHERE ${activeExecutionSql()}
        )::int AS active_executions
      FROM campaign_runs run
      LEFT JOIN campaign_run_contacts contact
        ON contact.run_id = run.id
      LEFT JOIN call_executions execution
        ON execution.run_id = run.id
      WHERE run.status NOT IN ('COMPLETED', 'FAILED', 'CANCELLED', 'ARCHIVED')
        OR EXISTS (
          SELECT 1 FROM campaign_iteration_links link
          WHERE link.iteration_id = run.iteration_id
            AND link.status NOT IN ('COMPLETED', 'LOCKED', 'ARCHIVED', 'CANCELLED')
        )
      GROUP BY run.id, run.iteration_id, run.run_number, run.run_name, run.status
      ORDER BY run.created_at
    `
  );

  console.log("Open Run lifecycle candidates:");
  console.table(result.rows);

  if (!apply) {
    console.log("Dry run only. Re-run with --apply to reconcile these Runs.");
  } else {
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
  }
} catch (error) {
  console.error("Run lifecycle reconciliation failed:", error);
  process.exitCode = 1;
} finally {
  db.release();
  await pool.end();
}
