import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const runtimeRoot = path.resolve(
  process.argv[2] || "/opt/sarvam-voice-analytics"
);
const packageRoot = path.dirname(fileURLToPath(import.meta.url));
const marker = "DATABASE_CREDENTIAL_RESILIENCE_V1";
const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 17);

async function copy(sourceName, destination) {
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(path.join(packageRoot, sourceName), destination);
}

const serverPath = path.join(runtimeRoot, "src/server.js");
const originalServerSource = await readFile(serverPath, "utf8");
let nextServerSource = originalServerSource;

if (!originalServerSource.includes(marker)) {
  const importAnchor = /import\s+campaignsRoutes[\s\S]*?from\s+["']\.\/routes\/campaigns\.routes\.js["'];/m;
  const mountAnchor = /app\.use\(\s*["']\/api["']\s*,\s*campaignsRoutes\s*\);/m;

  if (!importAnchor.test(originalServerSource) || !mountAnchor.test(originalServerSource)) {
    throw new Error(`Unable to find API route anchors in ${serverPath}`);
  }

  nextServerSource = originalServerSource.replace(
    importAnchor,
    (value) => `${value}\n\n/* ${marker} */\nimport readinessRoutes\n  from "./routes/readiness.routes.js";`
  );
  nextServerSource = nextServerSource.replace(
    mountAnchor,
    (value) => `${value}\n\n/* ${marker} */\napp.use(readinessRoutes);`
  );
}

const postgresPath = path.join(runtimeRoot, "src/db/postgres.js");
await copyFile(postgresPath, `${postgresPath}.bak-database-resilience-${timestamp}`);
if (nextServerSource !== originalServerSource) {
  await copyFile(serverPath, `${serverPath}.bak-database-resilience-${timestamp}`);
}

await copy("postgres.js", postgresPath);
await copy(
  "resilient-database.js",
  path.join(runtimeRoot, "src/db/resilient-database.js")
);
await copy(
  "test-database-resilience.js",
  path.join(runtimeRoot, "src/db/test-database-resilience.js")
);
await copy(
  "readiness.routes.js",
  path.join(runtimeRoot, "src/routes/readiness.routes.js")
);

if (nextServerSource !== originalServerSource) {
  await writeFile(serverPath, nextServerSource);
}

console.log(`Enabled database credential resilience in ${runtimeRoot}`);
console.log(`Previous database adapter: ${postgresPath}.bak-database-resilience-${timestamp}`);
