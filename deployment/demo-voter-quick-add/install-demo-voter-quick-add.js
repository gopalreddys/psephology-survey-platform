import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const runtimeRoot = path.resolve(process.argv[2] || "/opt/sarvam-voice-analytics");
const packageRoot = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(runtimeRoot, "src/server.js");
const marker = "DEMO_VOTER_QUICK_ADD_V1";

let server = await readFile(serverPath, "utf8");
const voterImport = /import\s+votersRoutes\s+from\s+["']\.\/routes\/voters\.routes\.js["'];/m;
const voterMount = /app\.use\(\s*["']\/api["']\s*,\s*votersRoutes\s*\);/m;
if (!server.includes(marker) && (!voterImport.test(server) || !voterMount.test(server))) {
  throw new Error("Cannot find voter route anchors; no API files were changed");
}

await mkdir(path.join(runtimeRoot, "src/repositories"), { recursive: true });
await mkdir(path.join(runtimeRoot, "src/routes"), { recursive: true });
await copyFile(
  path.join(packageRoot, "demo-voter-quick-add.repository.js"),
  path.join(runtimeRoot, "src/repositories/demo-voter-quick-add.repository.js")
);
await copyFile(
  path.join(packageRoot, "demo-voter-quick-add.validation.js"),
  path.join(runtimeRoot, "src/repositories/demo-voter-quick-add.validation.js")
);
await copyFile(
  path.join(packageRoot, "demo-voter-quick-add.routes.js"),
  path.join(runtimeRoot, "src/routes/demo-voter-quick-add.routes.js")
);

if (!server.includes(marker)) {
  server = server.replace(
    voterImport,
    (anchor) => `${anchor}\n/* ${marker} */\nimport demoVoterQuickAddRoutes from "./routes/demo-voter-quick-add.routes.js";`
  );
  server = server.replace(
    voterMount,
    (anchor) => `${anchor}\n/* ${marker} */\napp.use("/api", demoVoterQuickAddRoutes);`
  );
  await copyFile(serverPath, `${serverPath}.bak-demo-voter-quick-add-${Date.now()}`);
  await writeFile(serverPath, server);
}

console.log(`Enabled Admin-only pre-launch demo voter quick add in ${runtimeRoot}`);
