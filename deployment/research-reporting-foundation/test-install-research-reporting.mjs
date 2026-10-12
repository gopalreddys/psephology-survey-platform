import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { installResearchReporting } from './install-research-reporting.js';

// Only isolated fixture directories created by this test are modified/deleted.
const sandbox = await mkdtemp(path.join(os.tmpdir(), 'research-reporting-installer-'));
const original = `import express from 'express';
import votersRoutes from './routes/voters.routes.js';
const app = express();
app.use('/api', votersRoutes);
app.listen(3000);
`;
const dependencies = [
  'src/db/postgres.js', 'src/middleware/auth.middleware.js', 'src/middleware/role.middleware.js',
  'src/repositories/analytics-workspace.repository.js', 'src/repositories/output-normalization.repository.js',
  'src/repositories/normalization-rules.json'
];
async function fixture(name, server = original, skip = null) {
  const root = path.join(sandbox, name);
  await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(path.join(root, 'src/server.js'), server);
  for (const file of dependencies.filter((item) => item !== skip)) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), file.endsWith('.json') ? '{}' : '// isolated dependency fixture\n');
  }
  return root;
}
try {
  const root = await fixture('valid');
  const dry = await installResearchReporting(root, { dryRun: true });
  assert.equal(dry.dryRun, true);
  assert.equal(dry.serverChanged, true);
  assert.equal(dry.files.length, 9);
  assert.equal(await readFile(path.join(root, 'src/server.js'), 'utf8'), original);
  assert.ok(!(await readdir(path.join(root, 'src/repositories'))).includes('research-report.js'));
  const first = await installResearchReporting(root);
  assert.equal(first.serverChanged, true);
  const patched = await readFile(path.join(root, 'src/server.js'), 'utf8');
  assert.ok(patched.indexOf('app.use("/api", researchReportRoutes)') < patched.indexOf("app.use('/api', votersRoutes)"), 'Per-endpoint report auth precedes legacy catalogue guards');
  assert.ok(patched.includes('import reportingContractRoutes'));
  assert.ok(patched.includes('import researchReportRoutes'));
  assert.equal((await readdir(path.join(root, 'src'))).filter((file) => file.includes('server.js.bak-research-reporting')).length, 1);
  for (const file of first.files) assert.ok((await readFile(file, 'utf8')).length > 0);
  const second = await installResearchReporting(root);
  assert.equal(second.serverChanged, false);
  assert.equal(await readFile(path.join(root, 'src/server.js'), 'utf8'), patched);
  assert.equal((patched.match(/app.use\("\/api", researchReportRoutes\)/g) || []).length, 1);
  assert.equal((await readdir(path.join(root, 'src'))).filter((file) => file.includes('server.js.bak-research-reporting')).length, 1);
  const target = path.join(root, 'src/repositories/research-report.js');
  await writeFile(target, '// existing changed module\n');
  await installResearchReporting(root);
  const backup = (await readdir(path.dirname(target))).find((file) => file.startsWith('research-report.js.bak-research-reporting-'));
  assert.equal(await readFile(path.join(path.dirname(target), backup), 'utf8'), '// existing changed module\n');

  for (const [name, server, missing] of [
    ['missing-anchor', 'const app = {};\n', null],
    ['missing-dependency', original, 'src/repositories/output-normalization.repository.js'],
    ['partial-registration', `${original}\n/* RESEARCH_REPORTING_FOUNDATION_V1 */\n`, null]
  ]) {
    const bad = await fixture(name, server, missing);
    await assert.rejects(installResearchReporting(bad));
    assert.equal(await readFile(path.join(bad, 'src/server.js'), 'utf8'), server);
    assert.ok(!(await readdir(path.join(bad, 'src/repositories'))).includes('research-report.js'), 'Prerequisite failure must precede all runtime writes');
  }
  await assert.rejects(installResearchReporting('/'), /runtime directory/);
  console.log('Research reporting installer tests passed: dry-run, prerequisites, mount order, backups and idempotency.');
} finally {
  await rm(sandbox, { recursive: true, force: true });
}
