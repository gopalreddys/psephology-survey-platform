import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = await mkdtemp(path.join(os.tmpdir(), 'psephology-comparison-install-'));
try {
  await mkdir(path.join(root, 'src/repositories'), { recursive: true });
  const server = 'import votersRoutes from "./routes/voters.routes.js";\nimport campaignsRoutes from "./routes/campaigns.routes.js";\napp.use("/api", votersRoutes);\napp.use("/api", campaignsRoutes);\n';
  await writeFile(path.join(root, 'src/server.js'), server);
  const oldRepository = '// existing implementation\n';
  await writeFile(path.join(root, 'src/repositories/dashboard.repository.js'), oldRepository);
  const install = () => execFileSync(process.execPath, [path.join(here, 'install-research-comparability.js'), root], { encoding: 'utf8' });
  assert.match(install(), /does not run migrations/);
  const installedServer = await readFile(path.join(root, 'src/server.js'), 'utf8');
  const backupDirs = await readdir(path.join(root, 'var/deployment-backups'));
  assert.equal(await readFile(path.join(root, 'var/deployment-backups', backupDirs[0], 'src/server.js'), 'utf8'), server);
  assert.equal(await readFile(path.join(root, 'var/deployment-backups', backupDirs[0], 'src/repositories/dashboard.repository.js'), 'utf8'), oldRepository);
  const markerNames = ['AMAZON_QUICK_ENTERPRISE_DASHBOARD_V1', 'CAMPAIGN_COMPARATIVE_ANALYSIS_V1', 'ANALYTICS_WORKSPACE_V1', 'PROGRAM_EXECUTIVE_DASHBOARD_V1', 'ROLE_DASHBOARD_V1'];
  for (const marker of markerNames) assert.ok(installedServer.includes(marker), `Route marker ${marker} installed`);
  for (const name of ['research-comparability', 'campaign-analysis', 'analytics-workspace', 'program-dashboard', 'dashboard']) {
    const target = path.join(root, 'src/repositories', `${name}.repository.js`);
    execFileSync(process.execPath, ['--check', target]);
  }
  assert.match(await readFile(path.join(root, 'sql/029_shared_comparison_gate.sql'), 'utf8'), /previous_iteration_id/);
  assert.match(await readFile(path.join(root, 'src/db/migrate-amazon-quick-dashboard.js'), 'utf8'), /029_shared_comparison_gate/);
  assert.match(await readFile(path.join(root, 'sql/030_normalized_output_reporting.sql'), 'utf8'), /analytics_research_enterprise_v2/);
  assert.match(await readFile(path.join(root, 'src/db/migrate-amazon-quick-dashboard.js'), 'utf8'), /buildNormalizationSqlFunction/);
  assert.match(await readFile(path.join(root, 'sql/031_audited_research_methodology.sql'), 'utf8'), /analytics_research_design_audit/);
  for (const file of ['research-methodology.repository.js', 'research-methodology-validation.js', 'campaign-visibility.repository.js']) {
    execFileSync(process.execPath, ['--check', path.join(root, 'src/repositories', file)]);
  }
  assert.match(await readFile(path.join(root, 'src/repositories/normalization-rules.json'), 'utf8'), /OUTPUT_TAXONOMY_V2/);
  assert.match(await readFile(path.join(root, 'src/repositories/output-normalization.repository.js'), 'utf8'), /summarizeOutput/);
  install();
  assert.equal(await readFile(path.join(root, 'src/server.js'), 'utf8'), installedServer, 'Installer is idempotent');
  const invalid = path.join(root, 'invalid');
  await mkdir(path.join(invalid, 'src'), { recursive: true });
  await writeFile(path.join(invalid, 'src/server.js'), 'unchanged-invalid-server');
  assert.throws(() => execFileSync(process.execPath, [path.join(here, 'install-research-comparability.js'), invalid], { stdio: 'pipe' }), /Command failed/);
  assert.equal(await readFile(path.join(invalid, 'src/server.js'), 'utf8'), 'unchanged-invalid-server');
  assert.deepEqual(await readdir(path.join(invalid, 'src')), ['server.js']);
} finally {
  // Only the exact directory created by this test is removed.
  await rm(root, { recursive: true, force: true });
}
console.log('Coordinated research comparison installation tests passed.');
