import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { installResearchCatalogAccess } from "./install-research-catalog-access.js";
import { marker, scopeCatalogueRouter } from "./catalogue-router-scope.mjs";

const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "psephology-catalog-access-"));
const routesRoot = path.join(fixtureRoot, "src/routes");

function fixture(name, { legacy = false, guard = "", extra = "" } = {}) {
  const routes = name === "voters.routes.js"
    ? `router.get("/voters/summary", requireAuth, (_req, res) => res.json([]));
router.get("/voters", requireAuth, (_req, res) => res.json([]));
router.post("/voters/upload", requireAuth, (_req, res) => res.json([]));`
    : `router.get("/questionnaires", requireAuth, (_req, res) => res.json([]));
router.get("/questionnaires/:id", requireAuth, (_req, res) => res.json([]));
router.post("/questionnaires", requireAuth, (_req, res) => res.json([]));
router.post("/questionnaires/:id/questions", requireAuth, (_req, res) => res.json([]));
router.put("/iterations/:iterationId/questionnaire", requireAuth, (_req, res) => res.json([]));`;
  return `import express from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
${legacy || guard ? 'import { requireRole } from "../middleware/role.middleware.js";' : ""}

const router = express.Router();
${legacy ? '/* RESEARCH_CATALOG_ADMIN_GUARD_V1 */\nrouter.use(requireAuth, requireRole(["SUPER_ADMIN", "ADMIN"]));' : guard}
${routes}
${extra}
export default router;
`;
}

try {
  await mkdir(routesRoot, { recursive: true });
  for (const name of ["voters.routes.js", "questionnaires.routes.js"]) {
    const original = fixture(name, { legacy: true });
    await writeFile(path.join(routesRoot, name), original);
    await chmod(path.join(routesRoot, name), 0o640);
    const fresh = scopeCatalogueRouter(fixture(name), name);
    assert.equal(fresh.changed, true);
    assert.equal(scopeCatalogueRouter(fresh.source, name).changed, false);
    assert.match(fresh.source, /import \{ requireRole \} from "\.\.\/middleware\/role\.middleware\.js";/);
  }
  const dry = await installResearchCatalogAccess(fixtureRoot, { dryRun: true });
  const originalOwnership = await stat(path.join(routesRoot, "voters.routes.js"));
  assert.equal(dry.dryRun, true);
  assert.equal((await readdir(routesRoot)).length, 2, "Dry-run creates neither backups nor temporary files");
  for (const name of ["voters.routes.js", "questionnaires.routes.js"]) assert.equal(await readFile(path.join(routesRoot, name), "utf8"), fixture(name, { legacy: true }));
  const installedResult = await installResearchCatalogAccess(fixtureRoot);
  assert.equal(installedResult.backups.length, 2);
  const namesAfterInstall = await readdir(routesRoot);
  assert.equal(namesAfterInstall.length, 4);
  assert.equal((await installResearchCatalogAccess(fixtureRoot)).files.every((item) => !item.changed), true);
  assert.deepEqual(await readdir(routesRoot), namesAfterInstall, "Idempotent re-run creates no backups");
  for (const name of ["voters.routes.js", "questionnaires.routes.js"]) {
    const installed = await readFile(path.join(routesRoot, name), "utf8");
    assert.equal(installed.includes("RESEARCH_CATALOG_ADMIN_GUARD_V1"), false);
    assert.equal(installed.split(marker).length - 1, 1);
    const installedStat = await stat(path.join(routesRoot, name));
    assert.equal(installedStat.mode & 0o777, 0o640);
    assert.equal(installedStat.uid, originalOwnership.uid, "Original owner is preserved");
    assert.equal(installedStat.gid, originalOwnership.gid, "Original group is preserved");
    const backup = installedResult.backups.find((item) => item.includes(`${name}.bak-`));
    assert.equal(await readFile(backup, "utf8"), fixture(name, { legacy: true }));
    assert.equal((await stat(backup)).mode & 0o777, 0o600);
  }
  const questionnaires = await readFile(path.join(routesRoot, "questionnaires.routes.js"), "utf8");
  assert.match(questionnaires, /router\.use\(\["\/questionnaires","\/iterations\/:iterationId\/questionnaire"\]/);
  assert.doesNotMatch(questionnaires, /router\.use\(\["\/iterations"\]/);
  for (const extra of [
    'router.get("/campaigns", requireAuth, () => {});',
    'router.get(prefix, requireAuth, () => {});',
    'router.get(`/voters/${suffix}`, requireAuth, () => {});',
    'router["get"]("/voters", requireAuth, () => {});',
    'router.route("/voters").get(() => {});',
    'const alias = router; alias.get("/campaigns", () => {});',
    'router.use(requireAuth);'
  ]) assert.throws(() => scopeCatalogueRouter(fixture("voters.routes.js", { extra }), "voters.routes.js"));
  for (const guard of [
    'router.use(requireAuth, requireRole(["SUPER_ADMIN", "ADMIN"]));',
    '/* RESEARCH_CATALOG_ADMIN_GUARD_V1 */\nrouter.use(requireAuth, requireRole(["SUPER_ADMIN", "ADMIN", "CAMPAIGN_MANAGER"]));',
    `/* ${marker} */\nrouter.use(["/"], requireAuth, requireRole(["SUPER_ADMIN", "ADMIN"]));`
  ]) assert.throws(() => scopeCatalogueRouter(fixture("voters.routes.js", { guard }), "voters.routes.js"));
  assert.throws(() => scopeCatalogueRouter(fixture("questionnaires.routes.js", { extra: 'router.put("/iterations/:iterationId/questionnaire/other", () => {});' }), "questionnaires.routes.js"));
  // A bad second file must not partially change the first or even create backups.
  const beforeFailure = fixture("voters.routes.js", { legacy: true });
  await writeFile(path.join(routesRoot, "voters.routes.js"), beforeFailure);
  await writeFile(path.join(routesRoot, "questionnaires.routes.js"), fixture("questionnaires.routes.js", { extra: 'router.get("/unknown", () => {});' }));
  const beforeNames = await readdir(routesRoot);
  await assert.rejects(installResearchCatalogAccess(fixtureRoot), /Unexpected catalogue route prefix/);
  assert.equal(await readFile(path.join(routesRoot, "voters.routes.js"), "utf8"), beforeFailure);
  assert.deepEqual(await readdir(routesRoot), beforeNames);
  console.log("Research catalogue scoped guard parsing, V1 upgrade, dry-run, backups, idempotence and fail-closed preflight tests passed.");
} finally {
  await rm(fixtureRoot, { recursive: true, force: true });
}
