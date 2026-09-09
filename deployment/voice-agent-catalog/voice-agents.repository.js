import { getDb } from "../db/postgres.js";
import { fetchSarvamDeployments } from "../services/sarvam-voice-agents.service.js";

const CATEGORIES = new Set(["URBAN_MALE", "URBAN_FEMALE", "RURAL_MALE", "RURAL_FEMALE"]);

function errorWithStatus(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function firstConnection(deployment) {
  const configs = Array.isArray(deployment.connection_configs) ? deployment.connection_configs : [];
  const outbound = configs.find(function (item) {
    return item.connection_id && Array.isArray(item.phone_numbers) && item.phone_numbers.length;
  });
  const fallbackPhone = Array.isArray(deployment.phone_numbers) ? deployment.phone_numbers[0] : null;
  return {
    connectionId: outbound?.connection_id || null,
    phoneNumber: outbound?.phone_numbers?.[0] || fallbackPhone || null
  };
}

function selectableSql(alias = "agent") {
  return `LOWER(${alias}.provider_status) = 'active'
    AND LOWER(${alias}.channel_direction) IN ('outbound', 'both')
    AND ${alias}.usage_category IS NOT NULL
    AND ${alias}.is_enabled = TRUE
    AND ${alias}.connection_id IS NOT NULL
    AND ${alias}.outbound_phone_number IS NOT NULL`;
}

export async function listVoiceAgents({ selectableOnly = false } = {}) {
  const db = await getDb();
  const result = await db.query(`
    SELECT agent.id, agent.provider_deployment_id, agent.app_id, agent.app_version,
      agent.provider_name, agent.description, agent.channel_direction,
      agent.provider_status, agent.connection_id, agent.outbound_phone_number,
      agent.usage_category, agent.is_enabled, agent.last_synced_at,
      (${selectableSql("agent")}) AS is_selectable
    FROM sarvam_voice_agents agent
    ${selectableOnly ? `WHERE ${selectableSql("agent")}` : ""}
    ORDER BY agent.usage_category NULLS LAST, agent.provider_name, agent.app_id
  `);
  return result.rows;
}

export async function synchronizeVoiceAgents(actor) {
  if (!["SUPER_ADMIN", "ADMIN"].includes(actor.role_code)) {
    throw errorWithStatus("Only Admin and Super Admin users can synchronize Sarvam agents", 403);
  }
  const deployments = await fetchSarvamDeployments();
  const db = await getDb();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const seen = [];
    for (const deployment of deployments) {
      const connection = firstConnection(deployment);
      const id = String(deployment.deployment_id);
      seen.push(id);
      await client.query(`
        INSERT INTO sarvam_voice_agents (
          provider_deployment_id, app_id, app_version, provider_name, description,
          channel_direction, provider_status, connection_id, outbound_phone_number,
          provider_payload, last_synced_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,NOW(),NOW())
        ON CONFLICT (provider_deployment_id) DO UPDATE SET
          app_id = EXCLUDED.app_id,
          app_version = EXCLUDED.app_version,
          provider_name = EXCLUDED.provider_name,
          description = EXCLUDED.description,
          channel_direction = EXCLUDED.channel_direction,
          provider_status = EXCLUDED.provider_status,
          connection_id = EXCLUDED.connection_id,
          outbound_phone_number = EXCLUDED.outbound_phone_number,
          provider_payload = EXCLUDED.provider_payload,
          last_synced_at = NOW(),
          updated_at = NOW()
      `, [id, deployment.app_id, Number(deployment.app_version), deployment.name || deployment.app_id,
        deployment.description || null, deployment.channel_direction || "unknown",
        deployment.status || "unknown", connection.connectionId, connection.phoneNumber,
        JSON.stringify(deployment)]);
    }
    await client.query(`
      UPDATE sarvam_voice_agents
      SET provider_status = 'unavailable', updated_at = NOW()
      WHERE NOT (provider_deployment_id = ANY($1::text[]))
    `, [seen]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  const agents = await listVoiceAgents();
  return { synchronized: deployments.length, agents };
}

export async function classifyVoiceAgent(id, input, actor) {
  if (!["SUPER_ADMIN", "ADMIN"].includes(actor.role_code)) {
    throw errorWithStatus("Only Admin and Super Admin users can classify voice agents", 403);
  }
  const category = input.usageCategory == null || input.usageCategory === ""
    ? null
    : String(input.usageCategory).trim().toUpperCase();
  if (category && !CATEGORIES.has(category)) {
    throw errorWithStatus("Voice-agent category is invalid", 400);
  }
  const db = await getDb();
  const result = await db.query(`
    UPDATE sarvam_voice_agents
    SET usage_category = $2,
      is_enabled = COALESCE($3::boolean, is_enabled),
      categorized_by_user_id = $4,
      categorized_at = NOW(),
      updated_at = NOW()
    WHERE id = $1
    RETURNING *
  `, [id, category, typeof input.isEnabled === "boolean" ? input.isEnabled : null, actor.id]);
  if (!result.rowCount) throw errorWithStatus("Voice agent not found", 404);
  return result.rows[0];
}

export async function getVoiceAgentForSelection(client, id) {
  const result = await client.query(`
    SELECT agent.* FROM sarvam_voice_agents agent
    WHERE agent.id = $1 AND ${selectableSql("agent")}
    FOR SHARE
  `, [id]);
  if (!result.rowCount) {
    throw errorWithStatus("Select a synchronized, categorized, active outbound Sarvam voice agent", 400);
  }
  return result.rows[0];
}

export function voiceAgentSnapshot(agent) {
  return {
    catalog_id: agent.id,
    provider: "SARVAM",
    provider_deployment_id: agent.provider_deployment_id,
    app_id: agent.app_id,
    app_version: Number(agent.app_version),
    connection_id: agent.connection_id,
    outbound_phone_number: agent.outbound_phone_number,
    usage_category: agent.usage_category,
    provider_name: agent.provider_name,
    captured_at: new Date().toISOString()
  };
}

export async function getSarvamVoiceAgentForRunContact(runContactId) {
  const db = await getDb();
  const result = await db.query(`
    SELECT campaign.voice_agent_snapshot
    FROM campaign_run_contacts contact
    JOIN campaign_runs run ON run.id = contact.run_id
    JOIN campaign_iteration_links link ON link.iteration_id = run.iteration_id
    JOIN campaigns campaign ON campaign.id = link.campaign_id
    WHERE contact.id = $1
    ORDER BY link.created_at DESC
    LIMIT 1
  `, [runContactId]);
  const snapshot = result.rows[0]?.voice_agent_snapshot;
  if (!snapshot?.app_id || !snapshot?.app_version || !snapshot?.connection_id || !snapshot?.outbound_phone_number) {
    throw errorWithStatus("This campaign has no complete Sarvam voice-agent assignment", 409);
  }
  return snapshot;
}
