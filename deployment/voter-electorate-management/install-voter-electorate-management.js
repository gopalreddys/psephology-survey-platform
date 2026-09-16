import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const runtimeRoot = path.resolve(process.argv[2] || "/opt/sarvam-voice-analytics");
const packageRoot = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(runtimeRoot, "src/server.js");
const marker = "VOTER_ELECTORATE_MANAGEMENT_V1";

await mkdir(path.join(runtimeRoot, "src/repositories"), { recursive: true });
await mkdir(path.join(runtimeRoot, "src/routes"), { recursive: true });

for (const name of ["voter-electorate.repository.js", "voter-electorate.validation.js"]) {
  await copyFile(path.join(packageRoot, name), path.join(runtimeRoot, "src/repositories", name));
}
await copyFile(
  path.join(packageRoot, "voter-electorate.routes.js"),
  path.join(runtimeRoot, "src/routes/voter-electorate.routes.js")
);

for (const name of ["campaign-voter-selection.repository.js", "campaigns.repository.js"]) {
  await copyFile(
    path.resolve(packageRoot, "../campaign-workspace", name),
    path.join(runtimeRoot, "src/repositories", name)
  );
}

let server = await readFile(serverPath, "utf8");
const voterImport = /import\s+votersRoutes\s+from\s+["']\.\/routes\/voters\.routes\.js["'];/m;
const voterMount = /app\.use\(\s*["']\/api["']\s*,\s*votersRoutes\s*\);/m;
if (!server.includes(marker) && (!voterImport.test(server) || !voterMount.test(server))) {
  throw new Error("Cannot find voter route anchors; no API route was registered");
}
if (!server.includes(marker)) {
  server = server.replace(
    voterImport,
    (anchor) => `${anchor}\n/* ${marker} */\nimport voterElectorateRoutes from "./routes/voter-electorate.routes.js";`
  );
  server = server.replace(
    voterMount,
    (anchor) => `${anchor}\n/* ${marker} */\napp.use("/api", voterElectorateRoutes);`
  );
  await copyFile(serverPath, `${serverPath}.bak-voter-electorate-management-${Date.now()}`);
  await writeFile(serverPath, server);
}

console.log(`Enabled governed voter electorate management in ${runtimeRoot}`);
