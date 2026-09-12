import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const runtimeRoot = path.resolve(
  process.argv[2] || "/opt/sarvam-voice-analytics"
);
const packageRoot = path.dirname(fileURLToPath(import.meta.url));
const marker = "ITERATION_CLOSEOUT_V1";

async function copy(sourceName, destination) {
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(path.join(packageRoot, sourceName), destination);
}

await copy(
  "iteration-closeout.repository.js",
  path.join(runtimeRoot, "src/repositories/iteration-closeout.repository.js")
);
await copy(
  "iteration-closeout.routes.js",
  path.join(runtimeRoot, "src/routes/iteration-closeout.routes.js")
);

await mkdir(
  path.join(runtimeRoot, "src/repositories"),
  { recursive: true }
);
await copyFile(
  path.resolve(
    packageRoot,
    "../campaign-workspace/campaign-voter-selection.repository.js"
  ),
  path.join(
    runtimeRoot,
    "src/repositories/campaign-voter-selection.repository.js"
  )
);

for (const repositoryName of [
  "campaign-iterations.repository.js",
  "campaigns.repository.js"
]) {
  await copyFile(
    path.resolve(
      packageRoot,
      "../campaign-workspace",
      repositoryName
    ),
    path.join(
      runtimeRoot,
      "src/repositories",
      repositoryName
    )
  );
}

const serverPath = path.join(runtimeRoot, "src/server.js");
let source = await readFile(serverPath, "utf8");

if (!source.includes(marker)) {
  const importAnchor = /import\s+campaignIterationsRoutes[\s\S]*?from\s+["']\.\/routes\/campaign-iterations\.routes\.js["'];/m;
  const mountAnchor = /app\.use\(\s*["']\/api["']\s*,\s*campaignIterationsRoutes\s*\);/m;

  if (!importAnchor.test(source) || !mountAnchor.test(source)) {
    throw new Error(`Unable to find Campaign Iteration route anchors in ${serverPath}`);
  }

  source = source.replace(
    importAnchor,
    (value) => `${value}\n\n/* ${marker} */\nimport iterationCloseoutRoutes\n  from "./routes/iteration-closeout.routes.js";`
  );
  source = source.replace(
    mountAnchor,
    (value) => `${value}\n\n/* ${marker} */\napp.use("/api", iterationCloseoutRoutes);`
  );

  await writeFile(serverPath, source);
}

console.log(`Enabled governed Iteration closeout in ${runtimeRoot}`);
