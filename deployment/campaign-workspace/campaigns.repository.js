import { getDb } from "../db/postgres.js";

export async function listCampaigns() {
  const db = await getDb();
  const result = await db.query(`
    WITH RECURSIVE campaign_geographies AS (
      SELECT scope.campaign_id, scope.geo_unit_id
      FROM campaign_geo_scope scope
      UNION
      SELECT parent.campaign_id, child.id
      FROM campaign_geographies parent
      JOIN geo_units child ON child.parent_id = parent.geo_unit_id
      WHERE child.is_active = TRUE
    ),
    voter_counts AS (
      SELECT geography.campaign_id, COUNT(DISTINCT voter.id)::int AS eligible_voters
      FROM campaign_geographies geography
      JOIN voter_master voter ON voter.geo_unit_id = geography.geo_unit_id
      GROUP BY geography.campaign_id
    ),
    scope_counts AS (
      SELECT campaign_id, COUNT(*)::int AS mandal_count
      FROM campaign_geo_scope
      GROUP BY campaign_id
    ),
    assignment_counts AS (
      SELECT campaign_id, COUNT(*)::int AS assignment_count
      FROM campaign_mandal_assignments
      WHERE status <> 'REASSIGNED'
      GROUP BY campaign_id
    )
    SELECT campaign.id, campaign.campaign_code, campaign.campaign_name,
      campaign.target_type, campaign.target_name, campaign.target_code,
      campaign.status, campaign.start_date, campaign.end_date,
      COALESCE(scope_count.mandal_count, 0) AS mandal_count,
      COALESCE(assignment_count.assignment_count, 0) AS assignment_count,
      COALESCE(voter_count.eligible_voters, 0) AS eligible_voters
    FROM campaigns campaign
    LEFT JOIN scope_counts scope_count ON scope_count.campaign_id = campaign.id
    LEFT JOIN assignment_counts assignment_count ON assignment_count.campaign_id = campaign.id
    LEFT JOIN voter_counts voter_count ON voter_count.campaign_id = campaign.id
    WHERE campaign.status <> 'ARCHIVED'
    ORDER BY campaign.created_at DESC
  `);
  return result.rows;
}

export async function createCampaign(input) {
  const db = await getDb();
  const campaignCode = String(input.campaignCode || "").trim();
  const campaignName = String(input.campaignName || "").trim();
  const targetName = String(input.targetName || "").trim();
  const mandalIds = Array.from(new Set(Array.isArray(input.mandalIds) ? input.mandalIds : []));
  const assignments = Array.isArray(input.assignments) ? input.assignments : [];

  if (!campaignCode || !campaignName || !targetName || !input.jurisdictionId || !mandalIds.length) {
    const error = new Error("Campaign code, name, constituency and Mandal scope are required");
    error.statusCode = 400;
    throw error;
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const validMandals = await client.query(`
      SELECT id FROM geo_units
      WHERE id = ANY($1::uuid[]) AND geo_type = 'MANDAL' AND is_active = TRUE
    `, [mandalIds]);
    if (validMandals.rowCount !== mandalIds.length) {
      const error = new Error("Campaign scope contains an invalid or inactive Mandal");
      error.statusCode = 400;
      throw error;
    }

    const campaignResult = await client.query(`
      INSERT INTO campaigns (
        campaign_code, campaign_name, program_id, target_type, jurisdiction_id,
        target_name, target_code, start_date, end_date, created_by_user_id
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING *
    `, [campaignCode, campaignName, input.programId || null, input.targetType,
      input.jurisdictionId, targetName, input.targetCode || null, input.startDate || null,
      input.endDate || null, input.createdByUserId || null]);
    const campaign = campaignResult.rows[0];

    await client.query(`
      INSERT INTO campaign_geo_scope (campaign_id, geo_unit_id)
      SELECT $1, unnest($2::uuid[])
    `, [campaign.id, mandalIds]);

    const selectedIds = new Set(mandalIds);
    for (const assignment of assignments) {
      if (!selectedIds.has(assignment.mandalId) || !assignment.campaignerUserId) continue;
      await client.query(`
        INSERT INTO campaign_mandal_assignments (
          campaign_id, mandal_geo_unit_id, campaigner_user_id, assigned_by_user_id
        ) VALUES ($1,$2,$3,$4)
      `, [campaign.id, assignment.mandalId, assignment.campaignerUserId, input.createdByUserId || null]);
    }
    await client.query("COMMIT");
    return campaign;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
