import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const runtimeRoot = path.resolve(
  process.argv[2] || "/opt/sarvam-voice-analytics"
);
const packageRoot = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.resolve(
  packageRoot,
  "../campaign-workspace/campaign-voter-selection.repository.js"
);
const destinationPath = path.join(
  runtimeRoot,
  "src/repositories/campaign-voter-selection.repository.js"
);

await mkdir(path.dirname(destinationPath), { recursive: true });
await copyFile(sourcePath, destinationPath);

console.log(
  `Enabled strict retry-eligible Run cohorts in ${runtimeRoot}`
);
