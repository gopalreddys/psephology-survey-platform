import { copyFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  patchRunLaunchRoute,
  patchRunLaunchService
} from "./run-contact-selection.patch.js";

const runtimeRoot = path.resolve(
  process.argv[2] || "/opt/sarvam-voice-analytics"
);
const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, "");

const targets = [
  {
    path: path.join(runtimeRoot, "src/routes/runs.routes.js"),
    patch: patchRunLaunchRoute
  },
  {
    path: path.join(runtimeRoot, "src/services/run-launch.service.js"),
    patch: patchRunLaunchService
  }
];

const preparedTargets = [];

for (const target of targets) {
  const source = await readFile(target.path, "utf8");
  preparedTargets.push({
    ...target,
    source,
    updated: target.patch(source)
  });
}

for (const target of preparedTargets) {
  const { source, updated } = target;

  if (updated === source) {
    console.log(`Already enabled: ${target.path}`);
    continue;
  }

  const backupPath = `${target.path}.bak-contact-selection-${timestamp}`;
  await copyFile(target.path, backupPath);
  await writeFile(target.path, updated);
  console.log(`Updated ${target.path}`);
  console.log(`Backup written to ${backupPath}`);
}

console.log(`Enabled explicit Run contact selection in ${runtimeRoot}`);
