import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const apiRoot = resolve(process.argv[2] || "/opt/sarvam-voice-analytics");
const apply = process.argv.includes("--apply");
const { getDb } = await import(pathToFileURL(resolve(apiRoot, "src/db/postgres.js")).href);

const CAMPAIGN_ID = "f47beb7a-83f3-4241-88da-b639b9727089";
const ITERATION_ID = "5410403e-d257-4389-8c47-fba6ac31c666";
const QUESTIONNAIRE_ID = "eb55fbc2-54db-4609-80d4-7cf7118bb15d";
const APP_ID = "Political-A-b26ad56c-c4ae";
const OLD_OBJECTIVE = "Measure campaign movement and persuasion.";
const NEW_OBJECTIVE =
  "Measure campaign-stage awareness, concerns, and candidate and party perceptions without influencing respondents.";

const db = await getDb();
const client = await db.connect();
try {
  await client.query("BEGIN");
  const result = await client.query(`
    SELECT iteration.id, iteration.objective, iteration.research_phase,
      iteration.questionnaire_id, iteration.voice_agent_snapshot
    FROM program_iterations iteration
    JOIN campaign_iteration_links link ON link.iteration_id = iteration.id
    WHERE iteration.id = $1::uuid AND link.campaign_id = $2::uuid
    FOR UPDATE OF iteration
  `, [ITERATION_ID, CAMPAIGN_ID]);
  if (result.rowCount !== 1) throw new Error("Target Iteration was not found in the expected Campaign");

  const row = result.rows[0];
  const matches = row.research_phase === "CAMPAIGN" &&
    row.questionnaire_id === QUESTIONNAIRE_ID &&
    row.voice_agent_snapshot?.app_id === APP_ID &&
    Number(row.voice_agent_snapshot?.app_version) === 1;
  if (!matches) throw new Error("Iteration configuration differs from the expected prelaunch snapshot");

  if (row.objective === NEW_OBJECTIVE) {
    console.log("Objective already corrected; no update needed.");
  } else if (row.objective === OLD_OBJECTIVE) {
    if (!apply) {
      console.log("Guarded objective correction is ready. Re-run with --apply to update the Iteration.");
    } else {
      const updated = await client.query(`
        UPDATE program_iterations
        SET objective = $1, updated_at = NOW()
        WHERE id = $2::uuid AND objective = $3
        RETURNING id, objective
      `, [NEW_OBJECTIVE, ITERATION_ID, OLD_OBJECTIVE]);
      if (updated.rowCount !== 1) throw new Error("Objective changed during repair; no update applied");
      console.log("Corrected neutral objective for Iteration", updated.rows[0]);
    }
  } else {
    throw new Error("Objective differs from the known default; no update applied");
  }
  await client.query("COMMIT");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await db.end();
}
