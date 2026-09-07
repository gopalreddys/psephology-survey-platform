import { getDb } from "../db/postgres.js";

let programTableName = null;

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

async function discoverProgramTable(db) {
  if (programTableName) return programTableName;
  const result = await db.query(`
    SELECT table_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND column_name IN ('id', 'study_code', 'study_name', 'owner_user_id', 'status')
    GROUP BY table_name
    HAVING COUNT(DISTINCT column_name) = 5
    ORDER BY table_name
    LIMIT 1
  `);
  if (!result.rowCount) {
    const error = new Error("Unable to locate the research program table with owner assignment support");
    error.statusCode = 500;
    throw error;
  }
  programTableName = result.rows[0].table_name;
  return programTableName;
}

export async function listCampaignPrograms(actor) {
  if (!["SUPER_ADMIN", "ADMIN", "CAMPAIGN_MANAGER"].includes(actor.role_code)) {
    const error = new Error("Only Admins and assigned Campaign Managers can use campaign programs");
    error.statusCode = 403;
    throw error;
  }
  const db = await getDb();
  const table = quoteIdentifier(await discoverProgramTable(db));
  const values = [];
  let visibility = "TRUE";
  if (actor.role_code === "CAMPAIGN_MANAGER") {
    values.push(actor.id);
    visibility = `owner_user_id = $${values.length}`;
  }
  const result = await db.query(`
    SELECT id, study_code, study_name, study_type, status, owner_user_id
    FROM ${table}
    WHERE ${visibility}
      AND COALESCE(status, 'ACTIVE') NOT IN ('ARCHIVED', 'CANCELLED')
    ORDER BY study_name, study_code
  `, values);
  return result.rows;
}

export async function assertCampaignProgramAccess(programId, actor, db) {
  const table = quoteIdentifier(await discoverProgramTable(db));
  const values = [programId];
  let visibility = "TRUE";
  if (actor.role_code === "CAMPAIGN_MANAGER") {
    values.push(actor.id);
    visibility = `owner_user_id = $${values.length}`;
  }
  const result = await db.query(`
    SELECT id
    FROM ${table}
    WHERE id = $1
      AND ${visibility}
      AND COALESCE(status, 'ACTIVE') NOT IN ('ARCHIVED', 'CANCELLED')
  `, values);
  if (!result.rowCount) {
    const error = new Error("The selected research program is not assigned to this Campaign Manager or is unavailable");
    error.statusCode = 400;
    throw error;
  }
}
