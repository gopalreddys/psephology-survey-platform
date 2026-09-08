import { getDb } from "../db/postgres.js";

function accessError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

/**
 * Returns the campaign boundary for an iteration. A LEFT JOIN is intentional:
 * legacy program iterations remain visible to Admin/Super Admin users, while
 * operational users must use the campaign-owned iteration workflow.
 */
export async function getIterationAccessContext(iterationId, actor) {
  const db = await getDb();
  const result = await db.query(`
    SELECT
      iteration.id,
      iteration.study_id,
      iteration.status AS iteration_status,
      link.campaign_id,
      campaign.created_by_user_id AS campaign_owner_user_id,
      campaign.campaign_manager_user_id,
      campaign.status AS campaign_status,
      EXISTS (
        SELECT 1
        FROM campaign_work_allocations allocation
        WHERE allocation.campaign_id = link.campaign_id
          AND (allocation.iteration_id = iteration.id OR allocation.iteration_id IS NULL)
          AND allocation.campaigner_user_id = $2
          AND allocation.status <> 'REASSIGNED'
      ) AS has_active_allocation
    FROM program_iterations iteration
    LEFT JOIN campaign_iteration_links link
      ON link.iteration_id = iteration.id
    LEFT JOIN campaigns campaign
      ON campaign.id = link.campaign_id
    WHERE iteration.id = $1
    LIMIT 1
  `, [iterationId, actor.id]);

  if (!result.rowCount) {
    throw accessError("Iteration not found", 404);
  }

  return result.rows[0];
}

/**
 * Enforces the campaign boundary for a direct iteration/analysis/run request.
 * Admin roles retain read access to legacy iterations. Campaign Managers may
 * access only their own campaigns. Campaigners require an active allocation.
 */
export async function assertIterationAccess(iterationId, actor, options = {}) {
  const context = await getIterationAccessContext(iterationId, actor);
  const isAdmin = ["SUPER_ADMIN", "ADMIN"].includes(actor.role_code);

  if (isAdmin) return context;

  if (!context.campaign_id) {
    throw accessError("Iteration is not linked to an operational campaign", 403);
  }

  if (actor.role_code === "CAMPAIGN_MANAGER") {
    if (context.campaign_manager_user_id !== actor.id) {
      throw accessError("Campaign Manager can access only assigned campaign iterations", 403);
    }
    return context;
  }

  if (actor.role_code === "CAMPAIGNER") {
    if (!context.has_active_allocation) {
      throw accessError("Campaigner has no active allocation for this iteration", 403);
    }
    return context;
  }

  if (options.allowUnknownRole === true) return context;
  throw accessError("Role is not permitted to access this iteration", 403);
}

export function sendIterationAccessError(res, error, fallbackMessage) {
  return res.status(error.statusCode || 500).json({
    error: error.statusCode ? error.message : fallbackMessage
  });
}
