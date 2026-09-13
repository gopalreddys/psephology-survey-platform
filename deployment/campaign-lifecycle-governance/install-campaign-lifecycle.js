import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const runtimeRoot = path.resolve(
  process.argv[2] || "/opt/sarvam-voice-analytics"
);
const packageRoot = path.dirname(fileURLToPath(import.meta.url));
const marker = "CAMPAIGN_LIFECYCLE_GOVERNANCE_V1";

async function copy(source, destination) {
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(source, destination);
}

async function copyLocal(sourceName, destination) {
  await copy(path.join(packageRoot, sourceName), destination);
}

await copyLocal(
  "021_operational_lifecycle_audit.sql",
  path.join(runtimeRoot, "sql/021_operational_lifecycle_audit.sql")
);
await copyLocal(
  "migrate-campaign-lifecycle.js",
  path.join(runtimeRoot, "src/db/migrate-campaign-lifecycle.js")
);
await copyLocal(
  "recover-stale-callbacks.js",
  path.join(runtimeRoot, "src/db/recover-stale-callbacks.js")
);
await copyLocal(
  "lifecycle-audit.repository.js",
  path.join(runtimeRoot, "src/repositories/lifecycle-audit.repository.js")
);
await copyLocal(
  "campaign-lifecycle.repository.js",
  path.join(runtimeRoot, "src/repositories/campaign-lifecycle.repository.js")
);
await copyLocal(
  "stale-callback-recovery.repository.js",
  path.join(runtimeRoot, "src/repositories/stale-callback-recovery.repository.js")
);
await copyLocal(
  "campaign-lifecycle.routes.js",
  path.join(runtimeRoot, "src/routes/campaign-lifecycle.routes.js")
);
await copy(
  path.resolve(packageRoot, "../run-lifecycle-automation/run-lifecycle.repository.js"),
  path.join(runtimeRoot, "src/repositories/run-lifecycle.repository.js")
);
await copy(
  path.resolve(packageRoot, "../sarvam-outbound-webhook/sarvam-outbound-webhook.repository.js"),
  path.join(runtimeRoot, "src/repositories/sarvam-outbound-webhook.repository.js")
);
await copy(
  path.resolve(packageRoot, "../campaign-workspace/campaigns.repository.js"),
  path.join(runtimeRoot, "src/repositories/campaigns.repository.js")
);

const serverPath = path.join(runtimeRoot, "src/server.js");
let source = await readFile(serverPath, "utf8");

if (!source.includes(marker)) {
  const importAnchor = /import\s+campaignsRoutes[\s\S]*?from\s+["']\.\/routes\/campaigns\.routes\.js["'];/m;
  const mountAnchor = /app\.use\(\s*["']\/api["']\s*,\s*campaignsRoutes\s*\);/m;

  if (!importAnchor.test(source) || !mountAnchor.test(source)) {
    throw new Error(`Unable to find Campaign route anchors in ${serverPath}`);
  }

  source = source.replace(
    importAnchor,
    (value) => `${value}\n\n/* ${marker} */\nimport campaignLifecycleRoutes\n  from "./routes/campaign-lifecycle.routes.js";`
  );
  source = source.replace(
    mountAnchor,
    (value) => `${value}\n\n/* ${marker} */\napp.use("/api", campaignLifecycleRoutes);`
  );
  await writeFile(serverPath, source);
}

console.log(`Enabled Campaign lifecycle governance in ${runtimeRoot}`);
console.log("Run src/db/migrate-campaign-lifecycle.js before starting the API.");
