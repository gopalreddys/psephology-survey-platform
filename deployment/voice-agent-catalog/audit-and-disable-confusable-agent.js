import path from "node:path";
import { pathToFileURL } from "node:url";

const runtimeRoot = path.resolve(process.argv[2] || "/opt/sarvam-voice-analytics");
const keepAppId = process.argv.find((value) => value.startsWith("--keep-app-id="))?.split("=")[1];
const disableAppId = process.argv.find((value) => value.startsWith("--disable-app-id="))?.split("=")[1];
const apply = process.argv.includes("--apply");

function normalizedName(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function distance(left, right) {
  const a = normalizedName(left);
  const b = normalizedName(right);
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let row = 1; row <= a.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= b.length; column += 1) {
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + (a[row - 1] === b[column - 1] ? 0 : 1)
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[b.length];
}

function confusable(left, right) {
  const a = normalizedName(left);
  const b = normalizedName(right);
  const edit = distance(a, b);
  return a.length >= 8 && b.length >= 8 &&
    (edit <= 2 || edit / Math.max(a.length, b.length) <= 0.12);
}

const { getDb } = await import(
  pathToFileURL(path.join(runtimeRoot, "src/db/postgres.js")).href
);
const db = await getDb();

try {
  const agents = await db.query(`
    SELECT agent.id, agent.provider_name, agent.app_id, agent.app_version,
      agent.connection_id, agent.outbound_phone_number, agent.usage_category,
      agent.channel_direction, agent.provider_status, agent.is_enabled,
      agent.catalog_source, agent.updated_at,
      (SELECT COUNT(*)::int FROM program_iterations iteration
        WHERE iteration.voice_agent_id = agent.id
          AND UPPER(COALESCE(iteration.status, 'DRAFT')) NOT IN
            ('COMPLETED', 'LOCKED', 'ARCHIVED', 'CANCELLED')) AS active_iterations,
      (SELECT COUNT(*)::int FROM program_iterations iteration
        WHERE iteration.voice_agent_id = agent.id) AS total_iterations
    FROM sarvam_voice_agents agent
    ORDER BY agent.app_id, agent.app_version, agent.updated_at
  `);
  const currentByApp = new Map();
  for (const agent of agents.rows) {
    const current = currentByApp.get(agent.app_id);
    if (!current || Number(agent.app_version) > Number(current.app_version) ||
        (Number(agent.app_version) === Number(current.app_version) &&
          new Date(agent.updated_at) > new Date(current.updated_at))) {
      currentByApp.set(agent.app_id, agent);
    }
  }
  const current = Array.from(currentByApp.values());
  const conflicts = [];
  for (let left = 0; left < current.length; left += 1) {
    for (let right = left + 1; right < current.length; right += 1) {
      const a = current[left];
      const b = current[right];
      if (a.app_id === b.app_id || !a.is_enabled || !b.is_enabled) continue;
      if (a.connection_id !== b.connection_id ||
          a.outbound_phone_number !== b.outbound_phone_number ||
          a.usage_category !== b.usage_category ||
          !confusable(a.provider_name, b.provider_name)) continue;
      conflicts.push({
        first_name: a.provider_name,
        first_app_id: a.app_id,
        first_version: Number(a.app_version),
        first_active_iterations: Number(a.active_iterations),
        second_name: b.provider_name,
        second_app_id: b.app_id,
        second_version: Number(b.app_version),
        second_active_iterations: Number(b.active_iterations),
        connection_id: a.connection_id,
        outbound_phone_number: a.outbound_phone_number
      });
    }
  }

  console.log("Confusable enabled Agent Apps:");
  console.table(conflicts);

  const iterations = await db.query(`
    SELECT iteration.id, iteration.iteration_number,
      COALESCE(link.status, iteration.status) AS status,
      iteration.voice_agent_snapshot ->> 'provider_name' AS provider_name,
      iteration.voice_agent_snapshot ->> 'app_id' AS app_id,
      iteration.voice_agent_snapshot ->> 'app_version' AS app_version,
      iteration.voice_agent_snapshot ->> 'connection_id' AS connection_id,
      iteration.voice_agent_snapshot ->> 'version_changed_from' AS version_changed_from,
      (SELECT COUNT(*)::int FROM call_executions execution
        JOIN campaign_runs run ON run.id = execution.run_id
        WHERE run.iteration_id = iteration.id) AS executions
    FROM program_iterations iteration
    LEFT JOIN campaign_iteration_links link ON link.iteration_id = iteration.id
    WHERE iteration.voice_agent_snapshot ->> 'app_id' = ANY($1::text[])
    ORDER BY iteration.created_at DESC
  `, [current.map((agent) => agent.app_id)]);
  console.log("Iteration agent snapshots:");
  console.table(iterations.rows);

  if (!keepAppId && !disableAppId) {
    console.log({
      identityConflicts: conflicts.length,
      providerSubmissionPerformed: false,
      databaseMutationPerformed: false,
      next: "Choose the verified Sarvam App ID, then rerun with --keep-app-id=... --disable-app-id=..."
    });
    process.exitCode = conflicts.length ? 2 : 0;
  } else {
    if (!keepAppId || !disableAppId || keepAppId === disableAppId) {
      throw new Error("Provide two different values for --keep-app-id and --disable-app-id");
    }
    const pair = conflicts.find((item) =>
      [item.first_app_id, item.second_app_id].includes(keepAppId) &&
      [item.first_app_id, item.second_app_id].includes(disableAppId)
    );
    if (!pair) throw new Error("The requested App IDs are not a detected confusable identity pair");
    const disabledActive = Number(
      currentByApp.get(disableAppId)?.active_iterations || 0
    );
    if (disabledActive > 0) {
      throw new Error(
        `Refusing to disable ${disableAppId}; it is assigned to ${disabledActive} active Iteration(s)`
      );
    }
    if (!apply) {
      console.log({
        keepAppId,
        disableAppId,
        action: "ready_to_disable_confusable_catalog_identity",
        providerSubmissionPerformed: false,
        databaseMutationPerformed: false,
        next: "Repeat this command with --apply after confirming the two App IDs in Sarvam"
      });
    } else {
      const result = await db.query(`
        UPDATE sarvam_voice_agents
        SET is_enabled = FALSE, updated_at = NOW()
        WHERE app_id = $1 AND is_enabled = TRUE
        RETURNING id, app_id, app_version, provider_name, is_enabled
      `, [disableAppId]);
      console.table(result.rows);
      console.log({
        keepAppId,
        disabledAppId: disableAppId,
        disabledCatalogRows: result.rowCount,
        providerSubmissionPerformed: false,
        databaseMutationPerformed: true
      });
    }
  }
} finally {
  await db.end();
}
