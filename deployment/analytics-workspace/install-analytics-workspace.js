import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const runtimeRoot = path.resolve(process.argv[2] || "/opt/sarvam-voice-analytics");
const packageRoot = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(runtimeRoot, "src/server.js");
const marker = "ANALYTICS_WORKSPACE_V1";

await mkdir(path.join(runtimeRoot, "src/repositories"), { recursive: true });
await mkdir(path.join(runtimeRoot, "src/routes"), { recursive: true });
await copyFile(
  path.join(packageRoot, "analytics-workspace.repository.js"),
  path.join(runtimeRoot, "src/repositories/analytics-workspace.repository.js")
);
await copyFile(
  path.join(packageRoot, "analytics-workspace.routes.js"),
  path.join(runtimeRoot, "src/routes/analytics-workspace.routes.js")
);
await copyFile(
  path.resolve(packageRoot, "../campaign-draft-privacy/campaign-visibility.repository.js"),
  path.join(runtimeRoot, "src/repositories/campaign-visibility.repository.js")
);

let server = await readFile(serverPath, "utf8");
const importAnchor = /import\s+votersRoutes\s+from\s+["']\.\/routes\/voters\.routes\.js["'];/m;
const mountAnchor = /app\.use\(\s*["']\/api["']\s*,\s*votersRoutes\s*\);/m;

if (!server.includes(marker) && (!importAnchor.test(server) || !mountAnchor.test(server))) {
  throw new Error("Cannot find API route anchors; Analytics workspace was not registered");
}

if (!server.includes(marker)) {
  server = server.replace(
    importAnchor,
    (anchor) => `${anchor}\n/* ${marker} */\nimport analyticsWorkspaceRoutes from "./routes/analytics-workspace.routes.js";`
  );
  server = server.replace(
    mountAnchor,
    (anchor) => `${anchor}\n/* ${marker} */\napp.use("/api", analyticsWorkspaceRoutes);`
  );
  await copyFile(serverPath, `${serverPath}.bak-analytics-workspace-${Date.now()}`);
  await writeFile(serverPath, server);
}

console.log(`Enabled role-scoped Analytics workspace in ${runtimeRoot}`);
