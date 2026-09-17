import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const runtimeRoot = path.resolve(process.argv[2] || "/opt/sarvam-voice-analytics");
const packageRoot = path.dirname(fileURLToPath(import.meta.url));
const target = path.join(runtimeRoot, "src/repositories/campaign-iterations.repository.js");
const backupSuffix = new Date().toISOString().replaceAll(":", "-");

const replacements = [
  [
    "      WHERE study_id = $1\n    `, [campaign.program_id]);\n    const iterationNumber = Number(numberResult.rows[0].next_number);",
    "      WHERE campaign_id = $1\n    `, [campaignId]);\n    const iterationNumber = Number(numberResult.rows[0].next_number);\n    if (iterationNumber > 3) {\n      throw errorWithStatus(\"This campaign already has three iterations\", 409);\n    }"
  ],
  [
    "        voice_agent_id, voice_agent_snapshot\n      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,'{}'::jsonb,'{}'::jsonb,'DRAFT',$12,$13,$14::jsonb)",
    "        voice_agent_id, voice_agent_snapshot, campaign_id\n      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,'{}'::jsonb,'{}'::jsonb,'DRAFT',$12,$13,$14::jsonb,$15)"
  ],
  [
    "      JSON.stringify(voiceAgentSnapshot(voiceAgent))\n    ]);",
    "      JSON.stringify(voiceAgentSnapshot(voiceAgent)),\n      campaignId\n    ]);"
  ]
];

const current = await readFile(target, "utf8");
let updated = current;
for (const [oldText, newText] of replacements) {
  if (updated.includes(newText)) continue;
  if (updated.split(oldText).length !== 2) {
    throw new Error(`Expected one known Iteration-numbering anchor in ${target}; no files were changed.`);
  }
  updated = updated.replace(oldText, newText);
}

for (const [sourceName, destination] of [
  ["023_campaign_iteration_numbering.sql", path.join(runtimeRoot, "sql/023_campaign_iteration_numbering.sql")],
  ["migrate-campaign-iteration-numbering.js", path.join(runtimeRoot, "src/db/migrate-campaign-iteration-numbering.js")]
]) {
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(path.join(packageRoot, sourceName), destination);
}

if (updated !== current) {
  const backup = `${target}.bak-campaign-numbering-${backupSuffix}`;
  await copyFile(target, backup);
  await writeFile(target, updated);
  console.log(`Updated ${target}; backup: ${backup}`);
} else {
  console.log(`Campaign-local numbering is already installed in ${target}`);
}

console.log("Run the Campaign-local numbering migration while the API is stopped, then restart it.");
