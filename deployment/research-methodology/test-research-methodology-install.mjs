import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const temporary = await mkdtemp(path.join(os.tmpdir(), 'methodology-install-'));
const server = 'import votersRoutes from "./routes/voters.routes.js";\nimport campaignsRoutes from "./routes/campaigns.routes.js";\napp.use("/api", votersRoutes);\napp.use("/api", campaignsRoutes);\n';
const service = 'import { getDb } from "../db/postgres.js";\nexport async function launchRun({runId}) {\n  const db = await getDb();\n  return db.query("SELECT 1");\n}\n';
const oldCreation = '// preserved previous iteration implementation\n';
const invoke = (root) => execFileSync(process.execPath, [path.join(here, 'install-research-methodology.js'), root], { encoding: 'utf8', stdio: 'pipe' });
async function fixture(root, launchService) {
  await mkdir(path.join(root, 'src/services'), { recursive: true });
  await mkdir(path.join(root, 'src/repositories'), { recursive: true });
  await writeFile(path.join(root, 'src/server.js'), server);
  await writeFile(path.join(root, 'src/services/run-launch.service.js'), launchService);
  await writeFile(path.join(root, 'src/repositories/campaign-iterations.repository.js'), oldCreation);
}
try {
  const runtime = path.join(temporary, 'api');
  await fixture(runtime, service);
  assert.match(invoke(runtime), /No methods or historical question content were backfilled/);
  const installedService = await readFile(path.join(runtime, 'src/services/run-launch.service.js'), 'utf8');
  assert.match(installedService, /QUESTIONNAIRE_CONTENT_PRELAUNCH_V1/);
  assert.ok(installedService.indexOf('assertRunQuestionnaireContent(await getDb(), runId)') < installedService.indexOf('const db ='));
  const services = await readdir(path.join(runtime, 'src/services'));
  assert.equal(await readFile(path.join(runtime, 'src/services', services.find((name) => name.includes('.bak-questionnaire-launch-guard-'))), 'utf8'), service);
  const repositories = await readdir(path.join(runtime, 'src/repositories'));
  assert.equal(await readFile(path.join(runtime, 'src/repositories', repositories.find((name) => name.startsWith('campaign-iterations.repository.js.bak-methodology-'))), 'utf8'), oldCreation);
  for (const name of ['campaign-iterations.repository.js', 'questionnaire-snapshot.repository.js', 'research-methodology.repository.js', 'research-methodology-validation.js', 'campaign-visibility.repository.js']) {
    execFileSync(process.execPath, ['--check', path.join(runtime, 'src/repositories', name)]);
  }
  execFileSync(process.execPath, ['--check', path.join(runtime, 'src/routes/amazon-quick-dashboard.routes.js')]);
  assert.match(await readFile(path.join(runtime, 'sql/031_audited_research_methodology.sql'), 'utf8'), /analytics_research_design_audit/);
  assert.match(await readFile(path.join(runtime, 'src/db/migrate-amazon-quick-dashboard.js'), 'utf8'), /031_audited_research_methodology/);
  const installedCreation = await readFile(path.join(runtime, 'src/repositories/campaign-iterations.repository.js'), 'utf8');
  assert.match(installedCreation, /freezeQuestionnaireContent/);
  invoke(runtime);
  assert.equal(await readFile(path.join(runtime, 'src/services/run-launch.service.js'), 'utf8'), installedService);
  assert.equal(await readFile(path.join(runtime, 'src/repositories/campaign-iterations.repository.js'), 'utf8'), installedCreation);
  const invalid = path.join(temporary, 'invalid');
  await fixture(invalid, '// unknown launch layout');
  assert.throws(() => invoke(invalid), /Command failed/);
  assert.equal(await readFile(path.join(invalid, 'src/services/run-launch.service.js'), 'utf8'), '// unknown launch layout');
  assert.equal(await readFile(path.join(invalid, 'src/repositories/campaign-iterations.repository.js'), 'utf8'), oldCreation);
  assert.deepEqual(await readdir(path.join(invalid, 'src/repositories')), ['campaign-iterations.repository.js']);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
console.log('Audited methodology coordinated installer, backups and fail-closed tests passed.');
