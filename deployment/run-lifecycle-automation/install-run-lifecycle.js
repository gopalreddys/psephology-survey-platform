import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const runtimeRoot = path.resolve(
  process.argv[2] || "/opt/sarvam-voice-analytics"
);
const packageRoot = path.dirname(fileURLToPath(import.meta.url));
const marker = "RUN_LIFECYCLE_AUTOMATION_V1";

async function copy(sourceName, destination) {
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(path.join(packageRoot, sourceName), destination);
}

await copy(
  "run-lifecycle.repository.js",
  path.join(runtimeRoot, "src/repositories/run-lifecycle.repository.js")
);
await copy(
  "run-lifecycle.routes.js",
  path.join(runtimeRoot, "src/routes/run-lifecycle.routes.js")
);
await copy(
  "reconcile-open-runs.js",
  path.join(runtimeRoot, "src/db/reconcile-open-runs.js")
);
await mkdir(path.join(runtimeRoot, "src/repositories"), { recursive: true });
await copyFile(
  path.resolve(packageRoot, "../campaign-workspace/run-access.repository.js"),
  path.join(runtimeRoot, "src/repositories/run-access.repository.js")
);
await copyFile(
  path.resolve(
    packageRoot,
    "../sarvam-outbound-webhook/sarvam-outbound-webhook.repository.js"
  ),
  path.join(runtimeRoot, "src/repositories/sarvam-outbound-webhook.repository.js")
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
    (value) => `${value}\n\n/* ${marker} */\nimport runLifecycleRoutes\n  from "./routes/run-lifecycle.routes.js";`
  );
  source = source.replace(
    mountAnchor,
    (value) => `${value}\n\n/* ${marker} */\napp.use("/api", runLifecycleRoutes);`
  );

  await writeFile(serverPath, source);
}

console.log(`Enabled automated Run lifecycle reconciliation in ${runtimeRoot}`);
