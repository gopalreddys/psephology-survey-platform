import { getDb } from "../db/postgres.js";

function visibility(actor, parameterNumber) {
  if (actor.role_code === "SUPER_ADMIN") return { sql: "TRUE", values: [] };
  if (actor.role_code === "ADMIN") return {
    sql: `(campaign.campaign_manager_user_id IS NOT NULL OR campaign.created_by_user_id = $${parameterNumber})`,
    values: [actor.id]
  };
  if (actor.role_code === "CAMPAIGN_MANAGER") return {
    sql: `campaign.campaign_manager_user_id = $${parameterNumber}`,
    values: [actor.id]
  };
  return {
    sql: `EXISTS (
      SELECT 1 FROM campaign_work_allocations permitted
      WHERE permitted.campaign_id = campaign.id
        AND (permitted.iteration_id = iteration.id OR permitted.iteration_id IS NULL)
        AND permitted.campaigner_user_id = $${parameterNumber}
        AND permitted.status <> 'REASSIGNED'
    )`,
    values: [actor.id]
  };
}

function normalizedFilters(actor, input = {}, includeSelection = true) {
  const values = [];
  const access = visibility(actor, values.length + 1);
  values.push(...access.values);
  const clauses = [access.sql];
  const add = function (value) { values.push(value); return `$${values.length}`; };
  const campaignId = String(input.campaignId || "").trim();
  const status = String(input.status || "ALL").trim().toUpperCase();
  const search = String(input.search || "").trim();
  const from = String(input.from || "").trim();
  const to = String(input.to || "").trim();
  const iterationId = String(input.iterationId || "").trim();
  const runId = String(input.runId || "").trim();
  if (campaignId) clauses.push(`campaign.id = ${add(campaignId)}::uuid`);
  if (search) {
    const parameter = add(search);
    clauses.push(`(
      voter.full_name ILIKE '%' || ${parameter} || '%'
      OR campaign.campaign_name ILIKE '%' || ${parameter} || '%'
      OR campaign.campaign_code ILIKE '%' || ${parameter} || '%'
      OR execution.provider_attempt_id ILIKE '%' || ${parameter} || '%'
      OR RIGHT(COALESCE(voter.phone_number, ''), 4) = ${parameter}
    )`);
  }
  if (from) clauses.push(`execution.created_at >= ${add(from)}::date`);
  if (to) clauses.push(`execution.created_at < (${add(to)}::date + INTERVAL '1 day')`);
  if (includeSelection && iterationId) clauses.push(`iteration.id = ${add(iterationId)}::uuid`);
  if (includeSelection && runId) clauses.push(`run.id = ${add(runId)}::uuid`);
  if (status === "CONNECTED") clauses.push("LOWER(COALESCE(call_record.connectivity_status, '')) = 'connected'");
  else if (status === "FAILED") clauses.push("UPPER(execution.status) = 'FAILED'");
  else if (status === "AWAITING_CALLBACK") clauses.push("execution.callback_received_at IS NULL AND UPPER(execution.status) IN ('PENDING','SUBMITTED','RUNNING')");
  else if (status === "COMPLETED") clauses.push("UPPER(execution.status) = 'COMPLETED'");
  else if (status !== "ALL") {
    const error = new Error("Unsupported call status filter");
    error.statusCode = 400;
    throw error;
  }
  return { values, where: clauses.join(" AND ") };
}

const joins = `
  FROM call_executions execution
  JOIN campaign_runs run ON run.id = execution.run_id
  JOIN program_iterations iteration ON iteration.id = run.iteration_id
  JOIN campaign_iteration_links link ON link.iteration_id = iteration.id
  JOIN campaigns campaign ON campaign.id = link.campaign_id
  LEFT JOIN campaign_run_contacts contact ON contact.id = execution.run_contact_id
  LEFT JOIN voter_master voter ON voter.id = execution.voter_id
  LEFT JOIN sarvam_voice_agents voice_agent ON voice_agent.id = iteration.voice_agent_id
  LEFT JOIN LATERAL (
    SELECT call_item.* FROM calls call_item
    WHERE call_item.attempt_id = execution.provider_attempt_id
    ORDER BY call_item.updated_at DESC NULLS LAST
    LIMIT 1
  ) call_record ON TRUE
`;

function safeNumber(value, fallback, maximum) {
  return Math.min(Math.max(Number(value) || fallback, 1), maximum);
}

export async function listCallOperations(actor, input = {}) {
  const db = await getDb();
  const filtered = normalizedFilters(actor, input);
  const hierarchyFilters = normalizedFilters(actor, input, false);
  const limit = safeNumber(input.limit, 50, 200);
  const offset = Math.max(Number(input.offset) || 0, 0);
  const listValues = [...filtered.values, limit, offset];
  const limitParameter = `$${filtered.values.length + 1}`;
  const offsetParameter = `$${filtered.values.length + 2}`;

  const rowsPromise = db.query(`
    SELECT execution.id AS execution_id, execution.status AS execution_status,
      execution.provider_attempt_id, execution.attempt_number,
      execution.submitted_at, execution.callback_received_at,
      execution.created_at, execution.updated_at, execution.completed_at,
      execution.error_message,
      call_record.id AS call_id, call_record.interaction_id,
      call_record.connectivity_status, call_record.failure_reason,
      call_record.duration_seconds, call_record.num_messages,
      call_record.normalized_status, call_record.retry_eligible AS provider_retry_eligible,
      CASE WHEN jsonb_typeof(call_record.interaction_transcript) = 'array'
        THEN jsonb_array_length(call_record.interaction_transcript) ELSE 0 END AS transcript_turns,
      CASE WHEN jsonb_typeof(call_record.response_variables) = 'object'
        THEN (SELECT COUNT(*) FROM jsonb_object_keys(call_record.response_variables)) ELSE 0 END AS response_variables,
      voter.id AS voter_id, voter.full_name AS voter_name,
      RIGHT(COALESCE(voter.phone_number, ''), 4) AS phone_ending,
      voter.is_demo_contact,
      contact.attempt_status, contact.final_status, contact.retry_eligible,
      contact.retry_exhausted, contact.completion_reason,
      run.id AS run_id, run.run_number, run.run_name, run.status AS run_status,
      iteration.id AS iteration_id, iteration.iteration_number, iteration.iteration_name,
      campaign.id AS campaign_id, campaign.campaign_code, campaign.campaign_name,
      campaign.status AS campaign_status,
      COALESCE(voice_agent.provider_name, iteration.voice_agent_snapshot ->> 'provider_name',
        iteration.voice_agent_snapshot ->> 'app_id') AS voice_agent_name,
      COUNT(*) OVER()::int AS total_count
    ${joins}
    WHERE ${filtered.where}
    ORDER BY execution.created_at DESC
    LIMIT ${limitParameter} OFFSET ${offsetParameter}
  `, listValues);

  const summaryPromise = db.query(`
    SELECT COUNT(*)::int AS total_attempts,
      COUNT(*) FILTER (WHERE LOWER(COALESCE(call_record.connectivity_status, '')) = 'connected')::int AS connected,
      COUNT(*) FILTER (WHERE UPPER(execution.status) = 'FAILED')::int AS failed,
      COUNT(*) FILTER (WHERE execution.callback_received_at IS NULL
        AND UPPER(execution.status) IN ('PENDING','SUBMITTED','RUNNING'))::int AS awaiting_callback,
      COUNT(*) FILTER (WHERE CASE WHEN jsonb_typeof(call_record.interaction_transcript) = 'array'
        THEN jsonb_array_length(call_record.interaction_transcript) > 0 ELSE FALSE END)::int AS transcripts_captured,
      ROUND(AVG(call_record.duration_seconds) FILTER (
        WHERE LOWER(COALESCE(call_record.connectivity_status, '')) = 'connected'
      )::numeric, 1) AS average_duration_seconds
    ${joins}
    WHERE ${filtered.where}
  `, filtered.values);

  const hierarchyPromise = db.query(`
    SELECT campaign.id AS campaign_id, campaign.campaign_code, campaign.campaign_name,
      iteration.id AS iteration_id, iteration.iteration_number, iteration.iteration_name,
      run.id AS run_id, run.run_number, run.run_name, run.status AS run_status,
      COUNT(*)::int AS total_attempts,
      COUNT(*) FILTER (WHERE LOWER(COALESCE(call_record.connectivity_status, '')) = 'connected')::int AS connected,
      COUNT(*) FILTER (WHERE UPPER(execution.status) = 'FAILED')::int AS failed,
      COUNT(*) FILTER (WHERE execution.callback_received_at IS NULL
        AND UPPER(execution.status) IN ('PENDING','SUBMITTED','RUNNING'))::int AS awaiting_callback,
      COUNT(*) FILTER (WHERE CASE WHEN jsonb_typeof(call_record.interaction_transcript) = 'array'
        THEN jsonb_array_length(call_record.interaction_transcript) > 0 ELSE FALSE END)::int AS transcripts_captured,
      ROUND(AVG(call_record.duration_seconds) FILTER (
        WHERE LOWER(COALESCE(call_record.connectivity_status, '')) = 'connected'
      )::numeric, 1) AS average_duration_seconds,
      MAX(execution.created_at) AS latest_attempt_at
    ${joins}
    WHERE ${hierarchyFilters.where}
    GROUP BY campaign.id, campaign.campaign_code, campaign.campaign_name,
      iteration.id, iteration.iteration_number, iteration.iteration_name,
      run.id, run.run_number, run.run_name, run.status
    ORDER BY MAX(execution.created_at) DESC, iteration.iteration_number, run.run_number
  `, hierarchyFilters.values);

  const campaignVisibility = visibility(actor, 1);
  const campaignsPromise = db.query(`
    SELECT DISTINCT campaign.id, campaign.campaign_code, campaign.campaign_name
    ${joins}
    WHERE campaign.status <> 'ARCHIVED' AND ${campaignVisibility.sql}
    ORDER BY campaign.campaign_name
  `, campaignVisibility.values);

  const [rows, summary, hierarchy, campaigns] = await Promise.all([
    rowsPromise, summaryPromise, hierarchyPromise, campaignsPromise
  ]);
  return {
    items: rows.rows.map(function (row) { const { total_count, ...item } = row; return item; }),
    total: Number(rows.rows[0]?.total_count || 0),
    limit, offset,
    summary: summary.rows[0],
    hierarchy: hierarchy.rows,
    campaigns: campaigns.rows
  };
}

export async function getCallOperation(actor, executionId) {
  const db = await getDb();
  const access = visibility(actor, 2);
  const result = await db.query(`
    SELECT execution.id AS execution_id, execution.status AS execution_status,
      execution.provider_attempt_id, execution.attempt_number,
      execution.submitted_at, execution.callback_received_at,
      execution.created_at, execution.updated_at, execution.completed_at,
      execution.error_message,
      call_record.id AS call_id, call_record.interaction_id,
      call_record.connectivity_status, call_record.failure_reason,
      call_record.duration_seconds, call_record.num_messages,
      call_record.normalized_status,
      call_record.interaction_transcript, call_record.response_variables,
      call_record.analytical_snapshot,
      voter.id AS voter_id, voter.full_name AS voter_name,
      RIGHT(COALESCE(voter.phone_number, ''), 4) AS phone_ending,
      voter.is_demo_contact,
      contact.attempt_status, contact.final_status, contact.retry_eligible,
      contact.retry_exhausted, contact.completion_reason,
      run.id AS run_id, run.run_number, run.run_name, run.status AS run_status,
      iteration.id AS iteration_id, iteration.iteration_number, iteration.iteration_name,
      campaign.id AS campaign_id, campaign.campaign_code, campaign.campaign_name,
      COALESCE(voice_agent.provider_name, iteration.voice_agent_snapshot ->> 'provider_name',
        iteration.voice_agent_snapshot ->> 'app_id') AS voice_agent_name
    ${joins}
    WHERE execution.id = $1 AND ${access.sql}
    LIMIT 1
  `, [executionId, ...access.values]);
  return result.rows[0] || null;
}
