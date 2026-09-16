import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const runtimeRoot = path.resolve(process.argv[2] || "/opt/sarvam-voice-analytics");
const packageRoot = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(runtimeRoot, "src/server.js");
const marker = "PIPELINE_OPERATIONS_V1";

let server = await readFile(serverPath, "utf8");
const importAnchor = /import\s+votersRoutes\s+from\s+["']\.\/routes\/voters\.routes\.js["'];/m;
const mountAnchor = /app\.use\(\s*["']\/api["']\s*,\s*votersRoutes\s*\);/m;
if (!server.includes(marker) && (!importAnchor.test(server) || !mountAnchor.test(server))) {
  throw new Error("Cannot find API route anchors; Pipeline was not registered");
}

await mkdir(path.join(runtimeRoot, "src/repositories"), { recursive: true });
await mkdir(path.join(runtimeRoot, "src/routes"), { recursive: true });
await copyFile(path.join(packageRoot, "pipeline.repository.js"), path.join(runtimeRoot, "src/repositories/pipeline.repository.js"));
await copyFile(path.join(packageRoot, "pipeline.routes.js"), path.join(runtimeRoot, "src/routes/pipeline.routes.js"));

if (!server.includes(marker)) {
  server = server.replace(importAnchor,
    (anchor) => `${anchor}\n/* ${marker} */\nimport pipelineRoutes from "./routes/pipeline.routes.js";`);
  server = server.replace(mountAnchor,
    (anchor) => `${anchor}\n/* ${marker} */\napp.use("/api", pipelineRoutes);`);
  await copyFile(serverPath, `${serverPath}.bak-pipeline-${Date.now()}`);
  await writeFile(serverPath, server);
}
console.log(`Enabled Super Admin Pipeline in ${runtimeRoot}`);
