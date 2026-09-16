import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const runtimeRoot = path.resolve(process.argv[2] || "/opt/sarvam-voice-analytics");
const packageRoot = path.dirname(fileURLToPath(import.meta.url));

await mkdir(path.join(runtimeRoot, "sql"), { recursive: true });
await mkdir(path.join(runtimeRoot, "src/db"), { recursive: true });
await copyFile(
  path.join(packageRoot, "023_voter_electorate_model.sql"),
  path.join(runtimeRoot, "sql/023_voter_electorate_model.sql")
);
await copyFile(
  path.join(packageRoot, "migrate-voter-electorate-model.js"),
  path.join(runtimeRoot, "src/db/migrate-voter-electorate-model.js")
);

console.log("Installed voter electorate model in " + runtimeRoot);
console.log("Run node src/db/migrate-voter-electorate-model.js before electorate-aware imports.");
