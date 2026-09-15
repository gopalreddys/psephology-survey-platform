import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { evaluateCampaignBaseline } from "./baseline-evaluation.js";

const packageRoot = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(packageRoot, "../..");
const runtimeRoot = path.resolve(
  process.argv.find(function (value, index) {
    return index > 1 && !value.startsWith("--");
  }) || "/opt/sarvam-voice-analytics"
);
const campaignArgument = process.argv.find(function (value) {
  return value.startsWith("--campaign-id=");
});
const outputArgument = process.argv.find(function (value) {
  return value.startsWith("--output=");
});
const campaignId = campaignArgument
  ? campaignArgument.slice("--campaign-id=".length)
  : null;
const outputPath = outputArgument
  ? path.resolve(outputArgument.slice("--output=".length))
  : null;

function revision() {
  try {
    return execFileSync(
      "git",
      ["-C", repositoryRoot, "rev-parse", "HEAD"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    ).trim();
  } catch {
    return null;
  }
}

async function fingerprint(relativePath) {
  const absolutePath = path.join(runtimeRoot, relativePath);

  try {
    const content = await readFile(absolutePath);
    return {
      path: relativePath,
      sha256: createHash("sha256").update(content).digest("hex")
    };
  } catch {
    return { path: relativePath, sha256: null };
  }
}

const postgresModule = await import(
  pathToFileURL(path.join(runtimeRoot, "src/db/postgres.js")).href
);
const db = await postgresModule.getDb();

try {
  const database = await db.query(`
    SELECT
      current_database() AS database_name,
      current_user AS database_user,
      NOW() AS database_time
  `);
  const campaignResult = await db.query(
    `
      SELECT
        campaign.id,
        campaign.campaign_code,
        campaign.campaign_name,
        campaign.status,
        campaign.program_id,
        campaign.campaign_manager_user_id,
        manager.full_name AS campaign_manager_name,
        program.study_code AS program_code,
        program.study_name AS program_name,
        program.status AS program_status
      FROM campaigns campaign
      JOIN survey_studies program ON program.id = campaign.program_id
      LEFT JOIN users manager ON manager.id = campaign.campaign_manager_user_id
      WHERE ($1::uuid IS NOT NULL AND campaign.id = $1::uuid)
         OR ($1::uuid IS NULL AND UPPER(campaign.status) = 'COMPLETED')
      ORDER BY campaign.updated_at DESC
      LIMIT 1
    `,
    [campaignId]
  );

  if (!campaignResult.rowCount) {
    throw new Error(
      campaignId
        ? `Campaign ${campaignId} was not found`
        : "No completed Campaign is available for the demo baseline"
    );
  }

  const campaign = campaignResult.rows[0];
  const [iterationResult, runResult, contactResult, evidenceResult, lifecycleResult] =
    await Promise.all([
      db.query(
        `
          SELECT
            iteration.id,
            iteration.iteration_number,
            iteration.iteration_name,
            COALESCE(link.status, iteration.status) AS status,
            iteration.voice_agent_id,
            iteration.questionnaire_id
          FROM campaign_iteration_links link
          JOIN program_iterations iteration ON iteration.id = link.iteration_id
          WHERE link.campaign_id = $1
          ORDER BY iteration.iteration_number, iteration.created_at
        `,
        [campaign.id]
      ),
      db.query(
        `
          SELECT
            run.id,
            run.iteration_id,
            run.run_number,
            run.run_name,
            run.status
          FROM campaign_iteration_links link
          JOIN campaign_runs run ON run.iteration_id = link.iteration_id
          WHERE link.campaign_id = $1
          ORDER BY run.iteration_id, run.run_number
        `,
        [campaign.id]
      ),
      db.query(
        `
          SELECT
            COUNT(contact.id)::int AS selected_contacts,
            COUNT(contact.id) FILTER (
              WHERE COALESCE(voter.is_demo_contact, FALSE) = FALSE
            )::int AS non_demo_contacts,
            COUNT(contact.id) FILTER (
              WHERE COALESCE(contact.attempt_status, 'PENDING')
                NOT IN ('COMPLETED', 'FAILED')
            )::int AS pending_contacts
          FROM campaign_iteration_links link
          JOIN campaign_runs run ON run.iteration_id = link.iteration_id
          JOIN campaign_run_contacts contact ON contact.run_id = run.id
          LEFT JOIN voter_master voter ON voter.id = contact.voter_id
          WHERE link.campaign_id = $1
        `,
        [campaign.id]
      ),
      db.query(
        `
          SELECT
            COUNT(DISTINCT execution.id)::int AS executions,
            COUNT(DISTINCT execution.id) FILTER (
              WHERE execution.callback_received_at IS NOT NULL
            )::int AS callbacks_received,
            COUNT(DISTINCT execution.id) FILTER (
              WHERE COALESCE(execution.status, 'PENDING')
                NOT IN ('COMPLETED', 'FAILED', 'CANCELLED')
            )::int AS active_executions,
            COUNT(DISTINCT call_record.id) FILTER (
              WHERE LOWER(COALESCE(call_record.connectivity_status, '')) = 'connected'
            )::int AS connected_calls,
            COUNT(DISTINCT call_record.id) FILTER (
              WHERE LOWER(COALESCE(call_record.connectivity_status, '')) = 'connected'
                AND jsonb_typeof(call_record.interaction_transcript) = 'array'
                AND jsonb_array_length(call_record.interaction_transcript) > 0
            )::int AS transcripts_captured,
            COUNT(DISTINCT call_record.id) FILTER (
              WHERE LOWER(COALESCE(call_record.connectivity_status, '')) = 'connected'
                AND jsonb_typeof(call_record.response_variables) = 'object'
                AND call_record.response_variables <> '{}'::jsonb
            )::int AS responses_captured
          FROM campaign_iteration_links link
          JOIN campaign_runs run ON run.iteration_id = link.iteration_id
          LEFT JOIN call_executions execution ON execution.run_id = run.id
          LEFT JOIN calls call_record
            ON call_record.attempt_id = execution.provider_attempt_id
          WHERE link.campaign_id = $1
        `,
        [campaign.id]
      ),
      db.query(
        `
          SELECT COUNT(*)::int AS lifecycle_events
          FROM operational_lifecycle_events event
          WHERE event.entity_id = $1 OR event.parent_entity_id = $1
        `,
        [campaign.id]
      )
    ]);

  const evaluation = evaluateCampaignBaseline({
    campaign,
    iterations: iterationResult.rows,
    runs: runResult.rows,
    contacts: contactResult.rows[0],
    evidence: evidenceResult.rows[0],
    lifecycleEvents: lifecycleResult.rows[0].lifecycle_events
  });
  const fingerprints = await Promise.all([
    fingerprint("src/server.js"),
    fingerprint("src/db/postgres.js"),
    fingerprint("src/services/sarvam-execution.service.js"),
    fingerprint("src/repositories/sarvam-outbound-webhook.repository.js"),
    fingerprint("src/repositories/campaign-lifecycle.repository.js")
  ]);
  const report = {
    reportVersion: 1,
    generatedAt: new Date().toISOString(),
    uiRevision: revision(),
    runtimeRoot,
    database: database.rows[0],
    program: {
      id: campaign.program_id,
      code: campaign.program_code,
      name: campaign.program_name,
      status: campaign.program_status
    },
    campaign: {
      id: campaign.id,
      code: campaign.campaign_code,
      name: campaign.campaign_name,
      status: campaign.status,
      campaignManagerId: campaign.campaign_manager_user_id,
      campaignManagerName: campaign.campaign_manager_name
    },
    ...evaluation,
    iterations: iterationResult.rows,
    runs: runResult.rows,
    runtimeFingerprints: fingerprints
  };

  console.log("Demo release baseline:");
  console.table(report.checks);
  console.log("Release summary:");
  console.table([report.summary]);
  console.log(`Baseline status: ${report.status}`);

  if (outputPath) {
    await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, {
      mode: 0o600
    });
    console.log(`Sanitized baseline report written to ${outputPath}`);
  }

  if (report.status === "FAIL") process.exitCode = 2;
} catch (error) {
  console.error("Unable to capture demo release baseline:", error.message);
  process.exitCode = 1;
} finally {
  await db.end?.();
}
