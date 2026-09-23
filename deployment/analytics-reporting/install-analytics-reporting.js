import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const runtimeRoot = path.resolve(process.argv[2] || "/opt/sarvam-voice-analytics");
const packageRoot = path.dirname(fileURLToPath(import.meta.url));

await mkdir(path.join(runtimeRoot, "sql"), { recursive: true });
await mkdir(path.join(runtimeRoot, "src/db"), { recursive: true });
await copyFile(
  path.join(packageRoot, "023_quicksight_campaign_reporting.sql"),
  path.join(runtimeRoot, "sql/023_quicksight_campaign_reporting.sql")
);
await copyFile(
  path.join(packageRoot, "migrate-analytics-reporting.js"),
  path.join(runtimeRoot, "src/db/migrate-analytics-reporting.js")
);

console.log(`Installed aggregate Analytics reporting migration in ${runtimeRoot}`);
console.log("Run node src/db/migrate-analytics-reporting.js to create the governed BI view.");
