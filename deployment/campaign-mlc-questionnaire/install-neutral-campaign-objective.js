import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const apiRoot = resolve(process.argv[2] || "/opt/sarvam-voice-analytics");
const repositoryPath = resolve(apiRoot, "src/repositories/campaign-iterations.repository.js");
const oldDefault = 'CAMPAIGN: "Measure campaign movement and persuasion.",';
const newDefault =
  'CAMPAIGN: "Measure campaign-stage awareness, concerns, and candidate and party perceptions without influencing respondents.",';

const source = readFileSync(repositoryPath, "utf8");
if (source.includes(newDefault)) {
  console.log("Neutral Campaign objective default is already installed.");
} else {
  if (!source.includes(oldDefault)) {
    throw new Error(`Expected Campaign objective default was not found in ${repositoryPath}`);
  }
  const backupPath = `${repositoryPath}.bak-neutral-objective-${Date.now()}`;
  copyFileSync(repositoryPath, backupPath);
  writeFileSync(repositoryPath, source.replace(oldDefault, newDefault));
  console.log(`Installed neutral Campaign objective default in ${repositoryPath}`);
  console.log(`Backup written to ${backupPath}`);
}
