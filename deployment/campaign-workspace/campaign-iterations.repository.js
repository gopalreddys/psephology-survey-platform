import { getDb } from "../db/postgres.js";

const STAGES = new Set(["BASE", "CAMPAIGN", "TURNOUT"]);
const STATUSES = new Set(["PLANNED", "ACTIVE", "PAUSED", "COMPLETED", "LOCKED"]);

function errorWithStatus(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function campaignVisibility(actor, parameterNumber, iterationSpecific = false) {
  if (["SUPER_ADMIN", "ADMIN"].includes(actor.role_code)) {
    return { sql: "TRUE", values: [] };
  }

  if (actor.role_code === "CAMPAIGN_MANAGER") {
    return {
      sql: `(campaign.campaign_manager_user_id = $${parameterNumber}
        OR (campaign.campaign_manager_user_id IS NULL AND campaign.created_by_user_id = $${parameterNumber}))`,
      values: [actor.id]
    };
  }

  return {
    sql: `EXISTS (
      SELECT 1
      FROM campaign_work_allocations permitted
      WHERE permitted.campaign_id = campaign.id
        ${iterationSpecific ? "AND (permitted.iteration_id = link.iteration_id OR permitted.iteration_id IS NULL)" : ""}
        AND permitted.campaigner_user_id = $${parameterNumber}
        AND permitted.status <> 'REASSIGNED'
    )`,
    values: [actor.id]
  };
}

async function getCampaignContext(client, campaignId, actor, lock = false) {
  const visibility = campaignVisibility(actor, 2);
  const result = await client.query(`
    SELECT campaign.id, campaign.program_id, campaign.status,
      campaign.created_by_user_id, campaign.campaign_manager_user_id, campaign.campaign_name
    FROM campaigns campaign
    WHERE campaign.id = $1 AND ${visibility.sql}
    ${lock ? "FOR UPDATE" : ""}
  `, [campaignId, ...visibility.values]);

  if (!result.rowCount) throw errorWithStatus("Campaign not found", 404);
  return result.rows[0];
}

export async function listCampaignIterations(campaignId, actor) {
  const db = await getDb();
  const visibility = campaignVisibility(actor, 2, true);
  const result = await db.query(`
    SELECT
      iteration.id,
      link.campaign_id,
      iteration.study_id,
      iteration.iteration_number,
      iteration.iteration_name,
      iteration.research_phase,
      iteration.objective,
      iteration.sample_design_type,
      iteration.target_sample_size,
      iteration.planned_start_date,
      iteration.planned_end_date,
      COALESCE(link.status, CASE WHEN iteration.status = 'DRAFT' THEN 'PLANNED' ELSE iteration.status END) AS status,
      iteration.created_at,
      iteration.updated_at,
      0::int AS run_count
    FROM campaign_iteration_links link
    JOIN campaigns campaign ON campaign.id = link.campaign_id
    JOIN program_iterations iteration ON iteration.id = link.iteration_id
    WHERE link.campaign_id = $1 AND ${visibility.sql}
    ORDER BY iteration.iteration_number
  `, [campaignId, ...visibility.values]);
  return result.rows;
}

export async function createCampaignIteration({ campaignId, iterationName, researchPhase, objective,
  sampleDesignType, targetSampleSize, plannedStartDate, plannedEndDate, createdBy }) {
  const stage = String(researchPhase || "").trim().toUpperCase();
  if (!STAGES.has(stage)) throw errorWithStatus("Unsupported survey stage", 400);
  if (!String(iterationName || "").trim()) throw errorWithStatus("Iteration name is required", 400);
  if (!Number.isInteger(Number(targetSampleSize)) || Number(targetSampleSize) < 1) {
    throw errorWithStatus("Target sample size must be greater than zero", 400);
  }

  const db = await getDb();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const actor = { id: createdBy, role_code: "CAMPAIGN_MANAGER" };
    const campaign = await getCampaignContext(client, campaignId, actor, true);
    if (campaign.campaign_manager_user_id !== createdBy) {
      throw errorWithStatus("Only the Campaign Manager assigned to this campaign can create iterations", 403);
    }
    if (!campaign.program_id) throw errorWithStatus("Campaign must reference an Admin-assigned program", 400);
    if (["COMPLETED", "ARCHIVED"].includes(campaign.status)) {
      throw errorWithStatus("Iterations cannot be added to a completed or archived campaign", 409);
    }

    const numberResult = await client.query(`
      SELECT COALESCE(MAX(iteration_number), 0) + 1 AS next_number
      FROM program_iterations
      WHERE study_id = $1
    `, [campaign.program_id]);
    const iterationNumber = Number(numberResult.rows[0].next_number);
    const defaultObjective = {
      BASE: "Establish the voter thought baseline.",
      CAMPAIGN: "Measure campaign movement and persuasion.",
      TURNOUT: "Measure readiness and turnout intent."
    }[stage];

    const iterationResult = await client.query(`
      INSERT INTO program_iterations (
        study_id, iteration_number, iteration_name, research_phase, objective,
        sample_design_type, target_sample_size, planned_start_date, planned_end_date,
        questionnaire_id, agent_config, calling_profile, status, created_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NULL,'{}'::jsonb,'{}'::jsonb,'DRAFT',$10)
      RETURNING *
    `, [
      campaign.program_id,
      iterationNumber,
      String(iterationName).trim(),
      stage,
      objective || defaultObjective,
      sampleDesignType || "REPEATED_CROSS_SECTION",
      Number(targetSampleSize),
      plannedStartDate || null,
      plannedEndDate || null,
      createdBy
    ]);

    const iteration = iterationResult.rows[0];
    await client.query(`
      INSERT INTO campaign_iteration_links (campaign_id, iteration_id, created_by_user_id, status)
      VALUES ($1, $2, $3, 'PLANNED')
    `, [campaignId, iteration.id, createdBy]);

    await client.query("COMMIT");
    return { ...iteration, campaign_id: campaignId, status: "PLANNED", run_count: 0 };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function updateCampaignIterationStatus(campaignId, iterationId, nextStatus, actor) {
  const status = String(nextStatus || "").trim().toUpperCase();
  if (!STATUSES.has(status)) throw errorWithStatus("Unsupported iteration status", 400);
  if (actor.role_code === "CAMPAIGNER") throw errorWithStatus("Campaigners cannot change iteration status", 403);

  const db = await getDb();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const campaign = await getCampaignContext(client, campaignId, actor, true);
    if (actor.role_code === "CAMPAIGN_MANAGER" && campaign.campaign_manager_user_id !== actor.id) {
      throw errorWithStatus("Campaign Manager can update only assigned campaigns", 403);
    }

    const currentResult = await client.query(`
      SELECT link.status, link.iteration_id
      FROM campaign_iteration_links link
      WHERE link.campaign_id = $1 AND link.iteration_id = $2
      FOR UPDATE
    `, [campaignId, iterationId]);
    if (!currentResult.rowCount) throw errorWithStatus("Campaign iteration not found", 404);
    const current = currentResult.rows[0].status;
    const transitions = {
      PLANNED: ["ACTIVE", "LOCKED"],
      ACTIVE: ["PAUSED", "COMPLETED", "LOCKED"],
      PAUSED: ["ACTIVE", "COMPLETED", "LOCKED"],
      COMPLETED: ["LOCKED"],
      LOCKED: []
    };
    if (current !== status && !transitions[current]?.includes(status)) {
      throw errorWithStatus(`Iteration cannot move from ${current} to ${status}`, 400);
    }

    await client.query(`
      UPDATE campaign_iteration_links
      SET status = $3, updated_at = now()
      WHERE campaign_id = $1 AND iteration_id = $2
    `, [campaignId, iterationId, status]);
    await client.query(`
      UPDATE program_iterations
      SET status = $2, updated_at = now()
      WHERE id = $1
    `, [iterationId, status === "PLANNED" ? "DRAFT" : status]);
    await client.query("COMMIT");
    return { campaign_id: campaignId, iteration_id: iterationId, status };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function assertIterationBelongsToCampaign(client, campaignId, iterationId) {
  const result = await client.query(`
    SELECT link.iteration_id
    FROM campaign_iteration_links link
    WHERE link.campaign_id = $1 AND link.iteration_id = $2
    FOR UPDATE
  `, [campaignId, iterationId]);
  if (!result.rowCount) throw errorWithStatus("Campaign iteration not found", 404);
}

export async function listCampaignIterationAllocations(campaignId, iterationId, actor) {
  const db = await getDb();
  const campaign = await getCampaignContext(db, campaignId, actor);
  if (actor.role_code === "CAMPAIGN_MANAGER" && campaign.campaign_manager_user_id !== actor.id) {
    throw errorWithStatus("Campaign Manager can access only assigned campaigns", 403);
  }
  await assertIterationBelongsToCampaign(db, campaignId, iterationId);
  const result = await db.query(`
    SELECT allocation.id, allocation.iteration_id, allocation.allocation_level,
      allocation.geo_unit_id, allocation.local_body_area_id, allocation.status,
      COALESCE(geo.name, area.name) AS geography_name,
      COALESCE(geo.code, area.code) AS geography_code,
      account.id AS campaigner_user_id, account.full_name AS campaigner_name
    FROM campaign_work_allocations allocation
    JOIN users account ON account.id = allocation.campaigner_user_id
    LEFT JOIN geo_units geo ON geo.id = allocation.geo_unit_id
    LEFT JOIN local_body_electoral_areas area ON area.id = allocation.local_body_area_id
    WHERE allocation.campaign_id = $1 AND allocation.iteration_id = $2
      AND allocation.status <> 'REASSIGNED'
    ORDER BY allocation.allocation_level, geography_name
  `, [campaignId, iterationId]);
  return result.rows;
}

export async function saveCampaignIterationAllocations(campaignId, iterationId, allocations, actor) {
  if (actor.role_code !== "CAMPAIGN_MANAGER") {
    throw errorWithStatus("Only the assigned Campaign Manager can allocate iteration work", 403);
  }
  const rows = Array.isArray(allocations) ? allocations : [];
  if (!rows.length) throw errorWithStatus("Assign at least one District, Mandal or local electoral area", 400);

  const db = await getDb();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const campaign = await getCampaignContext(client, campaignId, actor, true);
    if (campaign.campaign_manager_user_id !== actor.id) {
      throw errorWithStatus("Only the Campaign Manager assigned to this campaign can allocate work", 403);
    }
    if (["COMPLETED", "ARCHIVED"].includes(campaign.status)) {
      throw errorWithStatus("Completed or archived campaigns cannot receive new allocations", 409);
    }
    await assertIterationBelongsToCampaign(client, campaignId, iterationId);

    const scopeResult = await client.query(`
      SELECT mandal.id, mandal.parent_id
      FROM campaign_geo_scope scope
      JOIN geo_units mandal ON mandal.id = scope.geo_unit_id
      WHERE scope.campaign_id = $1 AND mandal.is_active = TRUE
    `, [campaignId]);
    const scopeMandals = new Set(scopeResult.rows.map((row) => row.id));
    const scopeDistricts = new Set(scopeResult.rows.map((row) => row.parent_id).filter(Boolean));
    const seenDistricts = new Set();
    const seenMandals = new Set();
    const seenAreas = new Set();
    for (const row of rows) {
      const level = String(row.allocationLevel || "").toUpperCase();
      const geographyValid = ["DISTRICT", "MANDAL"].includes(level) && row.geoUnitId;
      const areaValid = level === "LOCAL_BODY_AREA" && row.localBodyAreaId;
      if ((!geographyValid && !areaValid) || !row.campaignerUserId) {
        throw errorWithStatus("Every iteration allocation requires a valid geography and Campaigner", 400);
      }
      if (level === "DISTRICT") {
        if (seenDistricts.has(row.geoUnitId)) throw errorWithStatus("A District can be assigned only once", 400);
        seenDistricts.add(row.geoUnitId);
      } else if (level === "MANDAL") {
        if (seenMandals.has(row.geoUnitId)) throw errorWithStatus("A Mandal can be assigned only once", 400);
        seenMandals.add(row.geoUnitId);
      } else {
        if (seenAreas.has(row.localBodyAreaId)) throw errorWithStatus("A local electoral area can be assigned only once", 400);
        seenAreas.add(row.localBodyAreaId);
      }
    }
    for (const districtId of seenDistricts) {
      if (!scopeDistricts.has(districtId)) throw errorWithStatus("District allocation is outside the campaign scope", 400);
      if (scopeResult.rows.some((row) => row.parent_id === districtId && seenMandals.has(row.id))) {
        throw errorWithStatus("A District and one of its Mandals cannot both be assigned", 400);
      }
    }
    for (const mandalId of seenMandals) {
      if (!scopeMandals.has(mandalId)) throw errorWithStatus("Mandal allocation is outside the campaign scope", 400);
    }
    if (seenAreas.size) {
      const campaignResult = await client.query("SELECT local_body_id FROM campaigns WHERE id = $1", [campaignId]);
      const localBodyId = campaignResult.rows[0]?.local_body_id;
      if (!localBodyId) throw errorWithStatus("Local electoral-area allocation requires a Local Body campaign", 400);
      const areas = await client.query(`
        SELECT id FROM local_body_electoral_areas
        WHERE id = ANY($1::uuid[]) AND local_body_id = $2 AND is_active = TRUE
      `, [Array.from(seenAreas), localBodyId]);
      if (areas.rowCount !== seenAreas.size) throw errorWithStatus("Local electoral-area allocation is outside the campaign target", 400);
    }

    const campaignerIds = Array.from(new Set(rows.map((row) => row.campaignerUserId)));
    const validCampaigners = await client.query(`
      SELECT account.id FROM users account
      JOIN roles role ON role.id = account.role_id
      WHERE account.id = ANY($1::uuid[]) AND account.status = 'ACTIVE' AND role.code = 'CAMPAIGNER'
    `, [campaignerIds]);
    if (validCampaigners.rowCount !== campaignerIds.length) {
      throw errorWithStatus("An allocation contains an inactive or invalid Campaigner", 400);
    }

    await client.query(`
      UPDATE campaign_work_allocations
      SET status = 'REASSIGNED', updated_at = NOW()
      WHERE campaign_id = $1 AND iteration_id = $2 AND status <> 'REASSIGNED'
    `, [campaignId, iterationId]);
    for (const row of rows) {
      const level = String(row.allocationLevel).toUpperCase();
      await client.query(`
        INSERT INTO campaign_work_allocations
          (campaign_id, iteration_id, allocation_level, geo_unit_id,
           local_body_area_id, campaigner_user_id, assigned_by_user_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
      `, [campaignId, iterationId, level, row.geoUnitId || null,
        row.localBodyAreaId || null, row.campaignerUserId, actor.id]);
    }
    await client.query("COMMIT");
    return listCampaignIterationAllocations(campaignId, iterationId, actor);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
