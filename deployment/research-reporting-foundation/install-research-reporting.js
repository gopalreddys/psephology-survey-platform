import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const marker = "RESEARCH_REPORTING_FOUNDATION_V1";
const repositoryFiles = [
  "reporting-contract.validation.js", "reporting-contract.repository.js",
  "report-catalog.js", "research-report.js", "research-report.repository.js",
  "fieldwork-diagnostics.js", "fieldwork-diagnostics.repository.js", "research-scope.repository.js"
];
const routeFiles = ["reporting-contract.routes.js", "research-report.routes.js"];

export async function installResearchReporting(runtimeRoot, { dryRun = false } = {}) {
  const root = path.resolve(runtimeRoot);
  if (root === path.parse(root).root) throw new Error("An application runtime directory is required");
  const serverPath = path.join(root, "src/server.js");
  const original = await readFile(serverPath, "utf8");
  const importAnchor = /import\s+votersRoutes\s+from\s+["']\.\/routes\/voters\.routes\.js["'];/m;
  const mountAnchor = /app\.use\(\s*["']\/api["']\s*,\s*votersRoutes\s*\);/m;
  if (!importAnchor.test(original) || !mountAnchor.test(original)) {
    throw new Error("Expected API route anchors were not found; no reporting files were installed");
  }
  // Validate all source files and dependency paths before the first runtime edit.
  for (const name of [...repositoryFiles, ...routeFiles]) {
    await readFile(path.join(here, name));
    execFileSync(process.execPath, ["--check", path.join(here, name)]);
  }
  for (const relative of [
    "src/db/postgres.js", "src/middleware/auth.middleware.js", "src/middleware/role.middleware.js",
    "src/repositories/campaign-visibility.repository.js",
    "src/repositories/output-normalization.repository.js", "src/repositories/normalization-rules.json"
  ]) await readFile(path.join(root, relative));

  const importLines = [
    'import reportingContractRoutes from "./routes/reporting-contract.routes.js";',
    'import researchReportRoutes from "./routes/research-report.routes.js";'
  ];
  const mountLines = [
    'app.use("/api", reportingContractRoutes);',
    'app.use("/api", researchReportRoutes);'
  ];
  const hasMarker = original.includes(marker);
  if (hasMarker && ![...importLines, ...mountLines].every((line) => original.includes(line))) {
    throw new Error("Reporting registration is incomplete; restore or review the existing server before installation");
  }
  const server = hasMarker ? original : original
    .replace(importAnchor, (anchor) => `${anchor}\n/* ${marker} */\n${importLines.join("\n")}`)
    // The routers authorize their own matching endpoints only. Register before
    // legacy catalog middleware so a catalog role guard cannot swallow reports.
    .replace(mountAnchor, (anchor) => `/* ${marker} */\n${mountLines.join("\n")}\n${anchor}`);
  const files = [
    ...repositoryFiles.map((name) => [path.join(here, name), path.join(root, "src/repositories", name)]),
    ...routeFiles.map((name) => [path.join(here, name), path.join(root, "src/routes", name)])
  ];
  if (dryRun) return { dryRun: true, files: files.map(([, target]) => target), serverChanged: server !== original };
  const backupStamp = Date.now();
  for (const [source, target] of files) {
    const contents = await readFile(source);
    let previous;
    try { previous = await readFile(target); } catch (error) { if (error.code !== "ENOENT") throw error; }
    if (previous?.equals(contents)) continue;
    await mkdir(path.dirname(target), { recursive: true });
    if (previous) await copyFile(target, `${target}.bak-research-reporting-${backupStamp}`);
    await copyFile(source, target);
  }
  if (server !== original) {
    await copyFile(serverPath, `${serverPath}.bak-research-reporting-${backupStamp}`);
    await writeFile(serverPath, server);
  }
  return { dryRun: false, files: files.map(([, target]) => target), serverChanged: server !== original };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await installResearchReporting(process.argv[2] || "/opt/sarvam-voice-analytics", {
    dryRun: process.argv.includes("--dry-run")
  });
  console.log(result.dryRun ? "Research reporting installation preflight passed; no files changed." : "Installed research contracts and aggregate reporting routes.");
  console.log("No historical questionnaires, calls or methods were backfilled. No calls, service restarts, database migrations or Quick publication were performed.");
  console.log("Deploy the matching frontend and restart the API through the approved release process.");
}
