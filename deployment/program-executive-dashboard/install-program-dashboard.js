import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const runtimeRoot = path.resolve(
  process.argv[2] || "/opt/sarvam-voice-analytics"
);
const packageRoot = path.dirname(fileURLToPath(import.meta.url));
const marker = "PROGRAM_EXECUTIVE_DASHBOARD_V1";

async function copy(sourceName, destination) {
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(path.join(packageRoot, sourceName), destination);
}

await copy(
  "program-dashboard.repository.js",
  path.join(runtimeRoot, "src/repositories/program-dashboard.repository.js")
);
await copy(
  "program-dashboard.routes.js",
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

console.log(`Enabled Program executive dashboard in ${runtimeRoot}`);
