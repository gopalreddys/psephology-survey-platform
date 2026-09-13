import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const runtimeRoot = path.resolve(
  process.argv[2] || "/opt/sarvam-voice-analytics"
);
const packageRoot = path.dirname(fileURLToPath(import.meta.url));
const dashboardRoot = path.resolve(packageRoot, "../program-executive-dashboard");
const campaignLifecycleRoot = path.resolve(packageRoot, "../campaign-lifecycle-governance");
const campaignWorkspaceRoot = path.resolve(packageRoot, "../campaign-workspace");
const marker = "PROGRAM_EXECUTIVE_DASHBOARD_V1";

async function copy(source, destination) {
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(source, destination);
}

await copy(
  path.join(packageRoot, "022_program_lifecycle_audit.sql"),
  path.join(runtimeRoot, "sql/022_program_lifecycle_audit.sql")
);
await copy(
  path.join(packageRoot, "migrate-program-lifecycle.js"),
  path.join(runtimeRoot, "src/db/migrate-program-lifecycle.js")
);
await copy(
  path.join(campaignLifecycleRoot, "lifecycle-audit.repository.js"),
  path.join(runtimeRoot, "src/repositories/lifecycle-audit.repository.js")
);
await copy(
  path.join(campaignWorkspaceRoot, "campaign-programs.repository.js"),
  path.join(runtimeRoot, "src/repositories/campaign-programs.repository.js")
);
await copy(
  path.join(campaignWorkspaceRoot, "campaigns.repository.js"),
  path.join(runtimeRoot, "src/repositories/campaigns.repository.js")
);
await copy(
  path.join(campaignLifecycleRoot, "campaign-lifecycle.repository.js"),
  path.join(runtimeRoot, "src/repositories/campaign-lifecycle.repository.js")
);
await copy(
  path.join(dashboardRoot, "program-dashboard.repository.js"),
  path.join(runtimeRoot, "src/repositories/program-dashboard.repository.js")
);
await copy(
  path.join(dashboardRoot, "program-dashboard.routes.js"),
  path.join(runtimeRoot, "src/routes/program-dashboard.routes.js")
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
    (value) => `${value}\n\n/* ${marker} */\nimport programDashboardRoutes\n  from "./routes/program-dashboard.routes.js";`
  );
  source = source.replace(
    mountAnchor,
    (value) => `${value}\n\n/* ${marker} */\napp.use("/api", programDashboardRoutes);`
  );
  await writeFile(serverPath, source);
}

console.log(`Enabled governed Program closeout in ${runtimeRoot}`);
console.log("Run src/db/migrate-program-lifecycle.js before starting the API.");
