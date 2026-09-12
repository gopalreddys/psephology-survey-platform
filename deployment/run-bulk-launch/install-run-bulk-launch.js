import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const runtimeRoot = path.resolve(process.argv[2] || "/opt/sarvam-voice-analytics");
const packageRoot = path.dirname(fileURLToPath(import.meta.url));
const marker = "RUN_BULK_LAUNCH_PREVIEW_V1";

async function copy(sourceName, destination) {
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(path.join(packageRoot, sourceName), destination);
}

await copy(
  "run-launch-preview.repository.js",
  path.join(runtimeRoot, "src/repositories/run-launch-preview.repository.js")
);
await copy(
  "run-launch-preview.routes.js",
  path.join(runtimeRoot, "src/routes/run-launch-preview.routes.js")
);
await mkdir(
  path.join(runtimeRoot, "src/repositories"),
  { recursive: true }
);
await copyFile(
  path.resolve(
    packageRoot,
    "../campaign-workspace/run-access.repository.js"
  ),
  path.join(runtimeRoot, "src/repositories/run-access.repository.js")
);

const serverPath = path.join(runtimeRoot, "src/server.js");
let source = await readFile(serverPath, "utf8");

if (!source.includes(marker)) {
  const importAnchor = /import\s+runsRoutes[\s\S]*?from\s+["']\.\/routes\/runs\.routes\.js["'];/m;
  const mountAnchor = /app\.use\(\s*["']\/api["']\s*,\s*runsRoutes\s*\);/m;

  if (!importAnchor.test(source) || !mountAnchor.test(source)) {
    throw new Error(`Unable to find Run route anchors in ${serverPath}`);
  }

  source = source.replace(
    importAnchor,
    (value) => `${value}\n\n/* ${marker} */\nimport runLaunchPreviewRoutes\n  from "./routes/run-launch-preview.routes.js";`
  );
  source = source.replace(
    mountAnchor,
    (value) => `${value}\n\n/* ${marker} */\napp.use("/api", runLaunchPreviewRoutes);`
  );

  await writeFile(serverPath, source);
}

console.log(`Enabled protected Run launch previews in ${runtimeRoot}`);
