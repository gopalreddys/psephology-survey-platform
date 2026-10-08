import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const packageRoot = path.dirname(fileURLToPath(import.meta.url));
const fixtureRoot = await mkdtemp(path.join(tmpdir(), "psephology-analysis-installers-"));
try {
  await mkdir(path.join(fixtureRoot, "src"));
  await writeFile(path.join(fixtureRoot, "src/server.js"), `import campaignsRoutes from "./routes/campaigns.routes.js";
import votersRoutes from "./routes/voters.routes.js";
app.use("/api", campaignsRoutes);
app.use("/api", votersRoutes);
`);
  const helper = await readFile(path.resolve(packageRoot, "../research-comparability/research-comparability.repository.js"), "utf8");
  for (const installer of ["install-campaign-analysis.js", "../analytics-workspace/install-analytics-workspace.js"]) {
    const run = spawnSync(process.execPath, [path.resolve(packageRoot, installer), fixtureRoot], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr || run.stdout);
    assert.equal(await readFile(path.join(fixtureRoot, "src/repositories/research-comparability.repository.js"), "utf8"), helper, `${installer} installs the canonical gate helper`);
    const rerun = spawnSync(process.execPath, [path.resolve(packageRoot, installer), fixtureRoot], { encoding: "utf8" });
    assert.equal(rerun.status, 0, rerun.stderr || rerun.stdout);
  }
  const server = await readFile(path.join(fixtureRoot, "src/server.js"), "utf8");
  assert.equal((server.match(/app\.use\("\/api", campaignAnalysisRoutes\)/g) || []).length, 1);
  assert.equal((server.match(/app\.use\("\/api", analyticsWorkspaceRoutes\)/g) || []).length, 1);
  console.log("Campaign and Analytics installer integration tests passed.");
} finally {
  await rm(fixtureRoot, { recursive: true, force: true });
}
