import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const runtimeRoot = path.resolve(
  process.argv[2] || "/opt/sarvam-voice-analytics"
);
const packageRoot = path.dirname(fileURLToPath(import.meta.url));
const deploymentRoot = path.dirname(packageRoot);

async function copy(source, destination) {
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(source, destination);
}

const repositoryCopies = [
  [packageRoot, "campaign-visibility.repository.js"],
  [path.join(deploymentRoot, "campaign-workspace"), "campaigns.repository.js"],
  [path.join(deploymentRoot, "campaign-workspace"), "campaign-iterations.repository.js"],
  [path.join(deploymentRoot, "campaign-workspace"), "iteration-access.repository.js"],
  [path.join(deploymentRoot, "campaign-lifecycle-governance"), "campaign-lifecycle.repository.js"],
  [path.join(deploymentRoot, "campaign-comparative-analysis"), "campaign-analysis.repository.js"],
  [path.join(deploymentRoot, "program-executive-dashboard"), "program-dashboard.repository.js"]
];

for (const [sourceRoot, fileName] of repositoryCopies) {
  await copy(
    path.join(sourceRoot, fileName),
    path.join(runtimeRoot, "src/repositories", fileName)
  );
}

console.log(`Enabled private unassigned Campaign drafts in ${runtimeRoot}`);
