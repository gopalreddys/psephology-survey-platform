import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const runtimeRoot = path.resolve(process.argv[2] || "/opt/sarvam-voice-analytics");
const packageRoot = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(runtimeRoot, "src/server.js");
const marker = "AMAZON_QUICK_ENTERPRISE_DASHBOARD_V1";

await mkdir(path.join(runtimeRoot, "sql"), { recursive: true });
await mkdir(path.join(runtimeRoot, "src/db"), { recursive: true });
await mkdir(path.join(runtimeRoot, "src/routes"), { recursive: true });
await mkdir(path.join(runtimeRoot, "src/jobs"), { recursive: true });
await copyFile(
  path.join(packageRoot, "024_amazon_quick_research_reporting.sql"),
  path.join(runtimeRoot, "sql/024_amazon_quick_research_reporting.sql")
);
await copyFile(
  path.join(packageRoot, "025_amazon_quick_geographic_heatmap.sql"),
  path.join(runtimeRoot, "sql/025_amazon_quick_geographic_heatmap.sql")
);
await copyFile(
  path.join(packageRoot, "026_telangana_administrative_boundaries.sql"),
  path.join(runtimeRoot, "sql/026_telangana_administrative_boundaries.sql")
);
await copyFile(
  path.join(packageRoot, "027_psephology_decision_reporting.sql"),
  path.join(runtimeRoot, "sql/027_psephology_decision_reporting.sql")
);
await copyFile(
  path.join(packageRoot, "028_research_design_comparability.sql"),
  path.join(runtimeRoot, "sql/028_research_design_comparability.sql")
);
await copyFile(
  path.join(packageRoot, "029_shared_comparison_gate.sql"),
  path.join(runtimeRoot, "sql/029_shared_comparison_gate.sql")
);
await copyFile(
  path.join(packageRoot, "migrate-amazon-quick-dashboard.js"),
  path.join(runtimeRoot, "src/db/migrate-amazon-quick-dashboard.js")
);
await copyFile(
  path.join(packageRoot, "amazon-quick-dashboard.routes.js"),
  path.join(runtimeRoot, "src/routes/amazon-quick-dashboard.routes.js")
);
await copyFile(
  path.join(packageRoot, "sync-telangana-boundaries.js"),
  path.join(runtimeRoot, "src/jobs/sync-telangana-boundaries.js")
);

let server = await readFile(serverPath, "utf8");
const importAnchor = /import\s+votersRoutes\s+from\s+["']\.\/routes\/voters\.routes\.js["'];/m;
const mountAnchor = /app\.use\(\s*["']\/api["']\s*,\s*votersRoutes\s*\);/m;
if (!server.includes(marker) && (!importAnchor.test(server) || !mountAnchor.test(server))) {
  throw new Error("Cannot find API route anchors; Amazon Quick dashboard was not registered");
}
if (!server.includes(marker)) {
  server = server.replace(
    importAnchor,
    (anchor) => `${anchor}\n/* ${marker} */\nimport amazonQuickDashboardRoutes from "./routes/amazon-quick-dashboard.routes.js";`
  );
  server = server.replace(
    mountAnchor,
    (anchor) => `${anchor}\n/* ${marker} */\napp.use("/api", amazonQuickDashboardRoutes);`
  );
  await copyFile(serverPath, `${serverPath}.bak-amazon-quick-${Date.now()}`);
  await writeFile(serverPath, server);
}

console.log(`Enabled Amazon Quick enterprise dashboard integration in ${runtimeRoot}`);
console.log("Run node src/db/migrate-amazon-quick-dashboard.js before restarting the API.");
console.log("Run node src/jobs/sync-telangana-boundaries.js --apply to load official TGRAC boundaries.");
console.log("Install @aws-sdk/client-quicksight when using API-generated embed sessions.");
