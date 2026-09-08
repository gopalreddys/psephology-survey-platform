import { getDb } from "../db/postgres.js";
import { assertIterationAccess } from "./iteration-access.repository.js";

function accessError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

export async function assertRunAccess(runId, actor, options = {}) {
  const db = await getDb();
  const result = await db.query(`
    SELECT run.id, run.iteration_id, run.status AS run_status,
      iteration.iteration_name, link.campaign_id
    FROM campaign_runs run
    JOIN program_iterations iteration ON iteration.id = run.iteration_id
    LEFT JOIN campaign_iteration_links link ON link.iteration_id = iteration.id
    WHERE run.id = $1
    LIMIT 1
  `, [runId]);

  if (!result.rowCount) throw accessError("Run not found", 404);
  const context = await assertIterationAccess(result.rows[0].iteration_id, actor);

  if (options.mutate === true && actor.role_code !== "CAMPAIGNER") {
    throw accessError("Only assigned Campaigners can change or execute Runs", 403);
  }

  return { ...result.rows[0], ...context };
}

export function sendRunAccessError(res, error, fallbackMessage) {
  return res.status(error.statusCode || 500).json({
    error: error.statusCode ? error.message : fallbackMessage
  });
}
