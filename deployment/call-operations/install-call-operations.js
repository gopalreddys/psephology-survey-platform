import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const runtimeRoot = path.resolve(process.argv[2] || "/opt/sarvam-voice-analytics");
const packageRoot = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(runtimeRoot, "src/server.js");
const marker = "CALL_OPERATIONS_WORKSPACE_V1";

await mkdir(path.join(runtimeRoot, "src/repositories"), { recursive: true });
await mkdir(path.join(runtimeRoot, "src/routes"), { recursive: true });
await copyFile(path.join(packageRoot, "call-operations.repository.js"), path.join(runtimeRoot, "src/repositories/call-operations.repository.js"));
await copyFile(path.join(packageRoot, "call-operations.routes.js"), path.join(runtimeRoot, "src/routes/call-operations.routes.js"));

let server = await readFile(serverPath, "utf8");
const importAnchor = /import\s+votersRoutes\s+from\s+["']\.\/routes\/voters\.routes\.js["'];/m;
const mountAnchor = /app\.use\(\s*["']\/api["']\s*,\s*votersRoutes\s*\);/m;
if (!server.includes(marker) && (!importAnchor.test(server) || !mountAnchor.test(server))) {
  throw new Error("Cannot find API route anchors; call operations were not registered");
}
if (!server.includes(marker)) {
  server = server.replace(importAnchor, (anchor) => `${anchor}\n/* ${marker} */\nimport callOperationsRoutes from "./routes/call-operations.routes.js";`);
  server = server.replace(mountAnchor, (anchor) => `${anchor}\n/* ${marker} */\napp.use("/api", callOperationsRoutes);`);
  await copyFile(serverPath, `${serverPath}.bak-call-operations-${Date.now()}`);
  await writeFile(serverPath, server);
}
console.log(`Enabled role-scoped Call Operations workspace in ${runtimeRoot}`);
