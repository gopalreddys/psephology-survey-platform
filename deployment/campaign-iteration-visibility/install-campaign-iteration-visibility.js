import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { installQuestionnaireSnapshot } from "../research-methodology/install-questionnaire-snapshot.js";

const runtimeRoot = path.resolve(process.argv[2] || "/opt/sarvam-voice-analytics");
const packageRoot = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(packageRoot, "../campaign-workspace");

const files = [
  ["campaign-iterations.repository.js", "src/repositories/campaign-iterations.repository.js"],
  ["campaign-iterations.routes.js", "src/routes/campaign-iterations.routes.js"]
];
await installQuestionnaireSnapshot(runtimeRoot);

for (const [, destination] of files) {
  await mkdir(path.dirname(path.join(runtimeRoot, destination)), { recursive: true });
}

for (const [source, destination] of files) {
  const destinationPath = path.join(runtimeRoot, destination);
  await copyFile(destinationPath, `${destinationPath}.bak-campaign-iteration-visibility-${Date.now()}`);
  await copyFile(path.join(workspaceRoot, source), destinationPath);
}

console.log(`Refreshed governed Campaign Iteration visibility in ${runtimeRoot}`);
