import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const packageRoot = path.dirname(fileURLToPath(import.meta.url));
const installerPath = path.join(packageRoot, "install-research-catalog-access.js");
const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "psephology-catalog-access-"));
const routesRoot = path.join(fixtureRoot, "src/routes");

const fixture = `import express from "express";
import { requireAuth } from "../middleware/auth.middleware.js";

const router = express.Router();

router.get("/records", requireAuth, async function (_req, res) {
  return res.json([]);
});

export default router;
`;

try {
  await mkdir(routesRoot, { recursive: true });
  for (const name of ["voters.routes.js", "questionnaires.routes.js"]) {
    await writeFile(path.join(routesRoot, name), fixture);
  }

  execFileSync(process.execPath, [installerPath, fixtureRoot], { stdio: "pipe" });
  execFileSync(process.execPath, [installerPath, fixtureRoot], { stdio: "pipe" });

  for (const name of ["voters.routes.js", "questionnaires.routes.js"]) {
    const installed = await readFile(path.join(routesRoot, name), "utf8");
    assert.match(installed, /import \{ requireRole \} from "\.\.\/middleware\/role\.middleware\.js";/);
    assert.match(installed, /router\.use\(requireAuth, requireRole\(\["SUPER_ADMIN", "ADMIN"\]\)\);/);
    assert.equal((installed.match(/RESEARCH_CATALOG_ADMIN_GUARD_V1/g) || []).length, 1);
  }

  console.log("Research catalog access installer tests passed.");
} finally {
  await rm(fixtureRoot, { recursive: true, force: true });
}
