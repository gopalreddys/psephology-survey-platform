import { getDb } from "../db/postgres.js";

const STAGES = new Set(["BASE", "CAMPAIGN", "TURNOUT"]);
const STATUSES = new Set(["PLANNED", "ACTIVE", "PAUSED", "COMPLETED", "LOCKED"]);

function errorWithStatus(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function campaignVisibility(actor, parameterNumber) {
  if (["SUPER_ADMIN", "ADMIN"].includes(actor.role_code)) {
    return { sql: "TRUE", values: [] };
  }

  if (actor.role_code === "CAMPAIGN_MANAGER") {
    return {
      sql: `campaign.created_by_user_id = $${parameterNumber}`,
      values: [actor.id]
    };
  }

  return {
    sql: `EXISTS (
      SELECT 1
      FROM campaign_work_allocations permitted
      WHERE permitted.campaign_id = campaign.id
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
      campaign.created_by_user_id, campaign.campaign_name
    FROM campaigns campaign
    WHERE campaign.id = $1 AND ${visibility.sql}
    ${lock ? "FOR UPDATE" : ""}
  `, [campaignId, ...visibility.values]);

  if (!result.rowCount) throw errorWithStatus("Campaign not found", 404);
  return result.rows[0];
}

export async function listCampaignIterations(campaignId, actor) {
  const db = await getDb();
  const visibility = campaignVisibility(actor, 2);
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
    if (campaign.created_by_user_id !== createdBy) {
      throw errorWithStatus("Only the Campaign Manager who created this campaign can create iterations", 403);
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
    if (actor.role_code === "CAMPAIGN_MANAGER" && campaign.created_by_user_id !== actor.id) {
      throw errorWithStatus("Campaign Manager can update only owned campaigns", 403);
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
