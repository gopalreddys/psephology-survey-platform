import { getDb } from "../db/postgres.js";
import { assertCampaignProgramAccess } from "./campaign-programs.repository.js";

function visibilitySql(actor, parameterNumber) {
  if (["SUPER_ADMIN", "ADMIN"].includes(actor.role_code)) return { sql: "TRUE", values: [] };
  if (actor.role_code === "CAMPAIGN_MANAGER") {
    return { sql: `campaign.created_by_user_id = $${parameterNumber}`, values: [actor.id] };
  }
  return { sql: `EXISTS (
    SELECT 1 FROM campaign_work_allocations visible
    WHERE visible.campaign_id = campaign.id
      AND visible.campaigner_user_id = $${parameterNumber}
      AND visible.status <> 'REASSIGNED'
  )`, values: [actor.id] };
}

export async function listCampaigns(actor) {
  const db = await getDb();
  const visibility = visibilitySql(actor, 1);
  const result = await db.query(`
    WITH RECURSIVE campaign_geographies AS (
      SELECT scope.campaign_id, scope.geo_unit_id FROM campaign_geo_scope scope
      UNION
      SELECT parent.campaign_id, child.id
      FROM campaign_geographies parent
      JOIN geo_units child ON child.parent_id = parent.geo_unit_id AND child.is_active = TRUE
    ), voter_counts AS (
      SELECT geography.campaign_id, COUNT(DISTINCT voter.id)::int AS eligible_voters
      FROM campaign_geographies geography
      JOIN voter_master voter ON voter.geo_unit_id = geography.geo_unit_id
      GROUP BY geography.campaign_id
    ), scope_counts AS (
      SELECT campaign_id, COUNT(*)::int AS mandal_count FROM campaign_geo_scope GROUP BY campaign_id
    ), allocation_counts AS (
      SELECT campaign_id, COUNT(*)::int AS assignment_count
      FROM campaign_work_allocations WHERE status <> 'REASSIGNED' GROUP BY campaign_id
    )
    SELECT campaign.id, campaign.campaign_code, campaign.campaign_name,
      campaign.target_domain, campaign.target_type, campaign.target_name, campaign.target_code,
      campaign.status, campaign.survey_stage, campaign.start_date, campaign.end_date, owner.full_name AS created_by_name,
      COALESCE(scope_count.mandal_count, 0) AS mandal_count,
      COALESCE(allocation_count.assignment_count, 0) AS assignment_count,
      COALESCE(voter_count.eligible_voters, 0) AS eligible_voters
    FROM campaigns campaign
    LEFT JOIN users owner ON owner.id = campaign.created_by_user_id
    LEFT JOIN scope_counts scope_count ON scope_count.campaign_id = campaign.id
    LEFT JOIN allocation_counts allocation_count ON allocation_count.campaign_id = campaign.id
    LEFT JOIN voter_counts voter_count ON voter_count.campaign_id = campaign.id
    WHERE campaign.status <> 'ARCHIVED' AND ${visibility.sql}
    ORDER BY campaign.created_at DESC
  `, visibility.values);
  return result.rows;
}

export async function getCampaignById(id, actor) {
  const db = await getDb();
  const visibility = visibilitySql(actor, 2);
  const campaignResult = await db.query(`
    SELECT campaign.*, owner.full_name AS created_by_name
    FROM campaigns campaign LEFT JOIN users owner ON owner.id = campaign.created_by_user_id
    WHERE campaign.id = $1 AND ${visibility.sql}
  `, [id, ...visibility.values]);
  if (!campaignResult.rowCount) return null;
  const campaignerFilter = actor.role_code === "CAMPAIGNER" ? "AND allocation.campaigner_user_id = $2" : "";
  const allocationValues = actor.role_code === "CAMPAIGNER" ? [id, actor.id] : [id];
  const scopeFilter = actor.role_code === "CAMPAIGNER" ? `AND EXISTS (
    SELECT 1 FROM campaign_work_allocations permitted
    LEFT JOIN local_body_area_geo_mapping area_mapping
      ON area_mapping.electoral_area_id = permitted.local_body_area_id AND area_mapping.is_active = TRUE
    LEFT JOIN geo_units mapped_geo ON mapped_geo.id = area_mapping.geo_unit_id
    WHERE permitted.campaign_id = scope.campaign_id
      AND permitted.campaigner_user_id = $2 AND permitted.status <> 'REASSIGNED'
      AND (
        permitted.geo_unit_id = mandal.id OR permitted.geo_unit_id = district.id
        OR mapped_geo.id = mandal.id OR mapped_geo.parent_id = mandal.id
        OR mapped_geo.id = district.id
      )
  )` : "";
  const [scopeResult, allocationResult] = await Promise.all([
    db.query(`
      SELECT mandal.id, mandal.name, mandal.code, district.id AS district_id,
        district.name AS district_name, district.code AS district_code
      FROM campaign_geo_scope scope JOIN geo_units mandal ON mandal.id = scope.geo_unit_id
      LEFT JOIN geo_units district ON district.id = mandal.parent_id
      WHERE scope.campaign_id = $1 ${scopeFilter} ORDER BY district.name, mandal.name
    `, allocationValues),
    db.query(`
      SELECT allocation.id, allocation.allocation_level, allocation.geo_unit_id,
        allocation.local_body_area_id, allocation.status,
        COALESCE(geo.name, area.name) AS geography_name,
        COALESCE(geo.code, area.code) AS geography_code,
        account.id AS campaigner_user_id, account.full_name AS campaigner_name
      FROM campaign_work_allocations allocation
      JOIN users account ON account.id = allocation.campaigner_user_id
      LEFT JOIN geo_units geo ON geo.id = allocation.geo_unit_id
      LEFT JOIN local_body_electoral_areas area ON area.id = allocation.local_body_area_id
      WHERE allocation.campaign_id = $1 AND allocation.status <> 'REASSIGNED' ${campaignerFilter}
      ORDER BY allocation.allocation_level, geography_name
    `, allocationValues)
  ]);
  return { ...campaignResult.rows[0], scope: scopeResult.rows, allocations: allocationResult.rows };
}

export async function updateCampaignStatus(id, nextStatus, actor) {
  if (!["SUPER_ADMIN", "ADMIN"].includes(actor.role_code)) {
    const error = new Error("Only Admin and Super Admin users can change campaign status"); error.statusCode = 403; throw error;
  }
  const status = String(nextStatus || "").trim().toUpperCase();
  if (!["ACTIVE", "PAUSED", "COMPLETED", "ARCHIVED"].includes(status)) {
    const error = new Error("Unsupported campaign status"); error.statusCode = 400; throw error;
  }
  const db = await getDb();
  const currentResult = await db.query("SELECT id, status FROM campaigns WHERE id = $1", [id]);
  if (!currentResult.rowCount) {
    const error = new Error("Campaign not found"); error.statusCode = 404; throw error;
  }
  const current = currentResult.rows[0].status;
  const transitions = {
    DRAFT: ["ACTIVE", "ARCHIVED"],
    ACTIVE: ["PAUSED", "COMPLETED", "ARCHIVED"],
    PAUSED: ["ACTIVE", "COMPLETED", "ARCHIVED"],
    COMPLETED: ["ARCHIVED"],
    ARCHIVED: [],
  };
  if (current === status) return currentResult.rows[0];
  if (!transitions[current]?.includes(status)) {
    const error = new Error(`Campaign cannot move from ${current} to ${status}`); error.statusCode = 400; throw error;
  }
  if (status === "ACTIVE") {
    const readiness = await db.query(`
      SELECT
        (SELECT COUNT(*) FROM campaign_geo_scope WHERE campaign_id = $1)::int AS scope_count,
        (SELECT COUNT(*) FROM campaign_work_allocations WHERE campaign_id = $1 AND status <> 'REASSIGNED')::int AS allocation_count
    `, [id]);
    const row = readiness.rows[0];
    if (!Number(row.scope_count) || !Number(row.allocation_count)) {
      const error = new Error("A campaign needs verified geography and at least one active allocation before activation"); error.statusCode = 400; throw error;
    }
  }
  const result = await db.query("UPDATE campaigns SET status = $2, updated_at = now() WHERE id = $1 RETURNING id, status, updated_at", [id, status]);
  return result.rows[0];
}

export async function listCampaignVoters(id, actor, { limit = 100, offset = 0 } = {}) {
  const campaign = await getCampaignById(id, actor);
  if (!campaign) return null;
  const db = await getDb();
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 1000);
  const safeOffset = Math.max(Number(offset) || 0, 0);
  const scopeSeed = actor.role_code === "CAMPAIGNER" ? `
      SELECT scope.geo_unit_id AS id
      FROM campaign_geo_scope scope
      JOIN geo_units mandal ON mandal.id = scope.geo_unit_id
      JOIN campaign_work_allocations allocation ON allocation.campaign_id = scope.campaign_id
        AND allocation.campaigner_user_id = $2 AND allocation.status <> 'REASSIGNED'
        AND (allocation.geo_unit_id = mandal.id OR allocation.geo_unit_id = mandal.parent_id)
      WHERE scope.campaign_id = $1
      UNION
      SELECT mapping.geo_unit_id AS id
      FROM campaign_work_allocations allocation
      JOIN local_body_area_geo_mapping mapping
        ON mapping.electoral_area_id = allocation.local_body_area_id AND mapping.is_active = TRUE
      WHERE allocation.campaign_id = $1 AND allocation.campaigner_user_id = $2
        AND allocation.status <> 'REASSIGNED'
    ` : `
      SELECT scope.geo_unit_id AS id
      FROM campaign_geo_scope scope JOIN campaigns selected ON selected.id = scope.campaign_id
      WHERE scope.campaign_id = $1 AND (
        selected.target_domain = 'LEGISLATIVE' OR NOT EXISTS (
          SELECT 1 FROM local_body_electoral_areas area
          JOIN local_body_area_geo_mapping mapping ON mapping.electoral_area_id = area.id AND mapping.is_active = TRUE
          WHERE area.local_body_id = selected.local_body_id AND area.is_active = TRUE
        )
      )
      UNION
      SELECT mapping.geo_unit_id AS id
      FROM campaigns selected
      JOIN local_body_electoral_areas area ON area.local_body_id = selected.local_body_id AND area.is_active = TRUE
      JOIN local_body_area_geo_mapping mapping ON mapping.electoral_area_id = area.id AND mapping.is_active = TRUE
      WHERE selected.id = $1 AND selected.target_domain = 'LOCAL_BODY'
    `;
  const limitParameter = actor.role_code === "CAMPAIGNER" ? 3 : 2;
  const values = actor.role_code === "CAMPAIGNER" ? [id, actor.id, safeLimit, safeOffset] : [id, safeLimit, safeOffset];
  const result = await db.query(`
    WITH RECURSIVE permitted_geographies AS (
      ${scopeSeed}
      UNION
      SELECT child.id FROM permitted_geographies parent
      JOIN geo_units child ON child.parent_id = parent.id AND child.is_active = TRUE
    )
    SELECT voter.*, COUNT(*) OVER()::int AS total_count
    FROM voter_master voter JOIN permitted_geographies geography ON geography.id = voter.geo_unit_id
    ORDER BY voter.id
    LIMIT $${limitParameter} OFFSET $${limitParameter + 1}
  `, values);
  return {
    items: result.rows.map(function (row) { const { total_count, ...voter } = row; return voter; }),
    total: Number(result.rows[0]?.total_count || 0), limit: safeLimit, offset: safeOffset
  };
}

export async function createCampaign(input, actor) {
  const db = await getDb();
  const campaignCode = String(input.campaignCode || "").trim();
  const campaignName = String(input.campaignName || "").trim();
  const targetName = String(input.targetName || "").trim();
  const programId = String(input.programId || "").trim();
  const surveyStage = String(input.surveyStage || "BASE").trim().toUpperCase();
  const mandalIds = Array.from(new Set(Array.isArray(input.mandalIds) ? input.mandalIds : []));
  const allocations = Array.isArray(input.assignments) ? input.assignments : [];
  if (!campaignCode || !campaignName || !programId || !targetName || !mandalIds.length) {
    const error = new Error("Campaign code, name, assigned research program, target and Administrative scope are required"); error.statusCode = 400; throw error;
  }
  if (!["BASE", "CAMPAIGN", "TURNOUT"].includes(surveyStage)) {
    const error = new Error("Survey iteration must be BASE, CAMPAIGN or TURNOUT"); error.statusCode = 400; throw error;
  }
  if (!allocations.length) {
    const error = new Error("Assign at least one District or Mandal"); error.statusCode = 400; throw error;
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await assertCampaignProgramAccess(programId, actor, client);
    const validMandals = await client.query(`
      SELECT id, parent_id FROM geo_units
      WHERE id = ANY($1::uuid[]) AND geo_type = 'MANDAL' AND is_active = TRUE
    `, [mandalIds]);
    if (validMandals.rowCount !== mandalIds.length) {
      const error = new Error("Campaign scope contains an invalid or inactive Mandal"); error.statusCode = 400; throw error;
    }
    if (input.targetDomain === "LEGISLATIVE" && !input.jurisdictionId) {
      const error = new Error("Legislative campaigns require a constituency"); error.statusCode = 400; throw error;
    }
    if (input.targetDomain === "LEGISLATIVE") {
      const permitted = await client.query(`
        WITH RECURSIVE jurisdiction_tree AS (
          SELECT id FROM jurisdictions WHERE id = $1 AND is_active = TRUE
          UNION ALL
          SELECT child.id FROM jurisdictions child
          JOIN jurisdiction_tree parent ON child.parent_jurisdiction_id = parent.id
          WHERE child.is_active = TRUE
        ), permitted_mandals AS (
          SELECT geography.id
          FROM jurisdiction_tree selected
          JOIN jurisdiction_geo_mapping mapping
            ON mapping.jurisdiction_id = selected.id AND mapping.is_active = TRUE
            AND mapping.coverage_type = 'FULL'
          JOIN geo_units geography ON geography.id = mapping.geo_unit_id
          WHERE geography.geo_type = 'MANDAL' AND geography.is_active = TRUE
          UNION
          SELECT mandal.id
          FROM jurisdiction_tree selected
          JOIN jurisdiction_geo_mapping mapping
            ON mapping.jurisdiction_id = selected.id AND mapping.is_active = TRUE
            AND mapping.coverage_type = 'FULL'
          JOIN geo_units district ON district.id = mapping.geo_unit_id
            AND district.geo_type = 'DISTRICT' AND district.is_active = TRUE
          JOIN geo_units mandal ON mandal.parent_id = district.id
            AND mandal.geo_type = 'MANDAL' AND mandal.is_active = TRUE
        )
        SELECT id FROM permitted_mandals WHERE id = ANY($2::uuid[])
      `, [input.jurisdictionId, mandalIds]);
      if (permitted.rowCount !== mandalIds.length) {
        const error = new Error("Campaign contains a Mandal outside the verified full constituency scope"); error.statusCode = 400; throw error;
      }
    }
    const scopeMandalIds = new Set(validMandals.rows.map(function (row) { return row.id; }));
    const scopeDistrictIds = new Set(validMandals.rows.map(function (row) { return row.parent_id; }).filter(Boolean));
    const seenDistricts = new Set();
    const seenMandals = new Set();
    const seenLocalAreas = new Set();
    for (const allocation of allocations) {
      const geographyValid = ["DISTRICT", "MANDAL"].includes(allocation.allocationLevel) && allocation.geoUnitId;
      const localAreaValid = allocation.allocationLevel === "LOCAL_BODY_AREA" && allocation.localBodyAreaId;
      if ((!geographyValid && !localAreaValid) || !allocation.campaignerUserId) {
        const error = new Error("Every allocation requires a valid level, geography and campaigner"); error.statusCode = 400; throw error;
      }
      if (allocation.allocationLevel === "DISTRICT") seenDistricts.add(allocation.geoUnitId);
      else if (allocation.allocationLevel === "MANDAL") seenMandals.add(allocation.geoUnitId);
      else seenLocalAreas.add(allocation.localBodyAreaId);
    }
    for (const districtId of seenDistricts) {
      if (!scopeDistrictIds.has(districtId)) { const error = new Error("District allocation is outside the campaign scope"); error.statusCode = 400; throw error; }
      if (validMandals.rows.some(function (row) { return row.parent_id === districtId && seenMandals.has(row.id); })) {
        const error = new Error("A District and one of its Mandals cannot both be assigned"); error.statusCode = 400; throw error;
      }
    }
    for (const mandalId of seenMandals) {
      if (!scopeMandalIds.has(mandalId)) { const error = new Error("Mandal allocation is outside the campaign scope"); error.statusCode = 400; throw error; }
    }
    const campaignerIds = Array.from(new Set(allocations.map(function (allocation) { return allocation.campaignerUserId; })));
    const validCampaigners = await client.query(`
      SELECT account.id FROM users account JOIN roles role ON role.id = account.role_id
      WHERE account.id = ANY($1::uuid[]) AND account.status = 'ACTIVE' AND role.code = 'CAMPAIGNER'
    `, [campaignerIds]);
    if (validCampaigners.rowCount !== campaignerIds.length) { const error = new Error("An allocation contains an inactive or invalid Campaigner"); error.statusCode = 400; throw error; }
    if (seenLocalAreas.size) {
      if (!input.localBodyId) { const error = new Error("Local electoral-area allocation requires a Local Body target"); error.statusCode = 400; throw error; }
      const validAreas = await client.query(`
        SELECT id FROM local_body_electoral_areas
        WHERE id = ANY($1::uuid[]) AND local_body_id = $2 AND is_active = TRUE
      `, [Array.from(seenLocalAreas), input.localBodyId]);
      if (validAreas.rowCount !== seenLocalAreas.size) { const error = new Error("Local electoral-area allocation is outside the campaign target"); error.statusCode = 400; throw error; }
    }

    const campaignResult = await client.query(`
      INSERT INTO campaigns (campaign_code, campaign_name, program_id, survey_stage, target_domain,
        target_type, jurisdiction_id, local_body_id, local_body_area_id, target_name,
        target_code, start_date, end_date, created_by_user_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *
    `, [campaignCode, campaignName, programId, surveyStage, input.targetDomain || "LEGISLATIVE",
      input.targetType, input.jurisdictionId || null, input.localBodyId || null,
      input.localBodyAreaId || null, targetName, input.targetCode || null,
      input.startDate || null, input.endDate || null, actor.id]);
    const campaign = campaignResult.rows[0];
    await client.query(`INSERT INTO campaign_geo_scope (campaign_id, geo_unit_id) SELECT $1, unnest($2::uuid[])`, [campaign.id, mandalIds]);
    for (const allocation of allocations) {
      await client.query(`
        INSERT INTO campaign_work_allocations (campaign_id, allocation_level, geo_unit_id,
          local_body_area_id, campaigner_user_id, assigned_by_user_id) VALUES ($1,$2,$3,$4,$5,$6)
      `, [campaign.id, allocation.allocationLevel, allocation.geoUnitId || null,
        allocation.localBodyAreaId || null, allocation.campaignerUserId, actor.id]);
    }
    await client.query("COMMIT");
    return campaign;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
