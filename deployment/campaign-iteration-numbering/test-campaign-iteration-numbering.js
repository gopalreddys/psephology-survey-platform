import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.dirname(fileURLToPath(import.meta.url));
const fixtureRoot = await mkdtemp(path.join(tmpdir(), "campaign-iteration-numbering-"));
const repositoryPath = path.join(fixtureRoot, "src/repositories/campaign-iterations.repository.js");
const oldSource = [
  "const numberResult = await client.query(`",
  "      SELECT COALESCE(MAX(iteration_number), 0) + 1 AS next_number",
  "      FROM program_iterations",
  "      WHERE study_id = $1",
  "    `, [campaign.program_id]);",
  "    const iterationNumber = Number(numberResult.rows[0].next_number);",
  "INSERT INTO program_iterations (",
  "        voice_agent_id, voice_agent_snapshot",
  "      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,'{}'::jsonb,'{}'::jsonb,'DRAFT',$12,$13,$14::jsonb)",
  "      JSON.stringify(voiceAgentSnapshot(voiceAgent))",
  "    ]);"
].join("\n");

try {
  await mkdir(path.dirname(repositoryPath), { recursive: true });
  await writeFile(repositoryPath, oldSource);

  const installer = path.join(packageRoot, "install-campaign-iteration-numbering.js");
  execFileSync(process.execPath, [installer, fixtureRoot], { stdio: "pipe" });
  const installed = await readFile(repositoryPath, "utf8");
  assert.match(installed, /WHERE campaign_id = \$1/);
  assert.match(installed, /iterationNumber > 3/);
  assert.match(installed, /voice_agent_snapshot, campaign_id/);
  assert.match(installed, /JSON\.stringify\(voiceAgentSnapshot\(voiceAgent\)\),\n      campaignId/);

  execFileSync(process.execPath, [installer, fixtureRoot], { stdio: "pipe" });
  assert.equal(await readFile(repositoryPath, "utf8"), installed);

  const sql = await readFile(path.join(packageRoot, "023_campaign_iteration_numbering.sql"), "utf8");
  assert.match(sql, /PARTITION BY link\.campaign_id/);
  assert.match(sql, /DROP CONSTRAINT IF EXISTS program_iterations_study_id_iteration_number_key/);
  assert.match(sql, /uq_campaign_iteration_number/);
  assert.match(sql, /iteration_number BETWEEN 1 AND 3/);

  console.log("Campaign-local Iteration numbering installer tests passed.");
} finally {
  await rm(fixtureRoot, { recursive: true, force: true });
}
