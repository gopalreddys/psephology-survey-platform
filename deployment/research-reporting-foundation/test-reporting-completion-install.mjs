// Real release-wrapper regression, using only isolated temporary API trees.
// No AWS, database connection, service command or provider action is executed.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { installReportingCompletion } from './install-reporting-completion.mjs';
import { rollbackRelease } from '../platform-consolidation/install-platform-consolidation.mjs';

const exec = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(here, '../..');
const manifest = JSON.parse(await readFile(path.join(here, 'reporting-completion-release.json'), 'utf8'));
const expectedTargets = [
  'src/repositories/output-normalization.repository.js',
  'src/repositories/normalization-rules.json',
  'src/repositories/report-catalog.js',
  'src/db/sync-reporting-normalization.mjs'
];
assert.deepEqual(manifest.files.map((entry) => entry.target), expectedTargets, 'The narrow release promotes exactly the four reviewed files');
assert.ok(manifest.files.every((entry) => !entry.target.endsWith('.sql')), 'No reporting view or historical migration is part of this installer');
assert.deepEqual(manifest.files.filter((entry) => entry.allowNew).map((entry) => entry.target), [expectedTargets[3]]);

const roots = [];
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function write(root, relative, contents) {
  await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
  await writeFile(path.join(root, relative), contents);
}
async function snapshot(root) {
  const files = {};
  async function walk(relative = '') {
    for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
      const next = path.join(relative, entry.name);
      if (entry.isDirectory()) await walk(next);
      else {
        assert.equal(entry.isFile(), true, 'The synthetic API contains regular files only');
        files[next.split(path.sep).join('/')] = digest(await readFile(path.join(root, next)));
      }
    }
  }
  await walk();
  return Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
}
async function exists(root, relative) {
  try { await readFile(path.join(root, relative)); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
const server = [
  'import reportingContractRoutes from "./routes/reporting-contract.routes.js";',
  'import researchReportRoutes from "./routes/research-report.routes.js";',
  'const app = { use() {} };',
  'app.use("/api", reportingContractRoutes);',
  'app.use("/api", researchReportRoutes);'
].join('\n') + '\n';
async function fixture() {
  const runtimeRoot = await mkdtemp(path.join(tmpdir(), 'psephology-reporting-completion-'));
  roots.push(runtimeRoot);
  await write(runtimeRoot, 'package.json', '{"name":"isolated-reporting-api","type":"module"}\n');
  await write(runtimeRoot, 'src/server.js', server);
  await write(runtimeRoot, 'src/routes/reporting-contract.routes.js', 'export default {};\n');
  await write(runtimeRoot, 'src/routes/research-report.routes.js', 'export default {};\n');
  for (const relative of manifest.requiredFiles) await write(runtimeRoot, relative, 'export const fixtureOnly = true;\n');
  // The real sync module may import this adapter, but preflight never executes
  // modules. Any accidental runtime import/use would fail rather than reach RDS.
  await write(runtimeRoot, 'src/db/postgres.js', 'export async function getDb() { throw new Error("Live database access forbidden in this fixture"); }\n');
  for (const [index, entry] of manifest.files.entries()) if (!entry.allowNew) {
    await write(runtimeRoot, entry.target, entry.target.endsWith('.json')
      ? JSON.stringify({ fixturePrevious: index }) + '\n'
      : `export const previousFixture = ${index};\n`);
  }
  await write(runtimeRoot, 'unrelated-user-record.txt', 'This unrelated fixture file must remain unchanged.\n');
  return { runtimeRoot };
}

try {
  const dry = await fixture();
  const beforeDry = await snapshot(dry.runtimeRoot);
  const planned = await installReportingCompletion(dry);
  assert.equal(planned.status, 'DRY_RUN');
  assert.equal(planned.runtimeChanged, false);
  assert.deepEqual(planned.changedFiles.map((entry) => entry.target), expectedTargets);
  assert.deepEqual(await snapshot(dry.runtimeRoot), beforeDry, 'Default dry run changes no file hashes and creates no release metadata');
  assert.deepEqual((await readdir(dry.runtimeRoot)).sort(), ['package.json', 'src', 'unrelated-user-record.txt']);
  assert.equal(await exists(dry.runtimeRoot, expectedTargets[3]), false);
  await assert.rejects(() => installReportingCompletion({ ...dry, apply: true }), /ack-api-stopped/);
  assert.deepEqual(await snapshot(dry.runtimeRoot), beforeDry, 'Missing stop acknowledgement fails before lock, backup, ledger or promotion');

  const applied = await fixture();
  const beforeApply = await snapshot(applied.runtimeRoot);
  const result = await installReportingCompletion({ ...applied, apply: true, ackApiStopped: true });
  assert.equal(result.status, 'COMMITTED');
  assert.equal(result.runtimeChanged, true);
  assert.match(result.releaseId, /^RESEARCH_REPORTING_COMPLETION_20261015_V1-\d{4}-\d{2}-\d{2}T[\dTZ-]+-[a-f0-9-]{36}$/);
  const ledger = JSON.parse(await readFile(path.join(applied.runtimeRoot, result.ledger), 'utf8'));
  assert.equal(ledger.status, 'COMMITTED');
  assert.equal(ledger.apiStoppedAcknowledged, true);
  assert.equal(ledger.manifestHash, result.manifestHash);
  assert.deepEqual(ledger.files.map((entry) => entry.target), expectedTargets);
  assert.deepEqual(ledger.promotedTargets, expectedTargets);
  for (const entry of manifest.files) {
    const actual = await readFile(path.join(applied.runtimeRoot, entry.target));
    const source = await readFile(path.join(repositoryRoot, entry.source));
    assert.equal(digest(actual), digest(source), `${entry.target}: exact real source content was promoted`);
    const record = ledger.files.find((item) => item.target === entry.target);
    assert.equal(record.sourceHash, digest(source));
    if (entry.allowNew) {
      assert.equal(record.previousHash, null);
      assert.equal(await exists(applied.runtimeRoot, `var/platform-releases/${result.releaseId}/backups/${entry.target}`), false);
    } else {
      assert.equal(record.previousHash, beforeApply[entry.target]);
      assert.equal(digest(await readFile(path.join(applied.runtimeRoot, `var/platform-releases/${result.releaseId}/backups/${entry.target}`))), beforeApply[entry.target]);
    }
  }
  const afterApply = await snapshot(applied.runtimeRoot);
  assert.equal(afterApply['src/server.js'], beforeApply['src/server.js'], 'The reporting wrapper never patches server registration');
  assert.equal(afterApply['unrelated-user-record.txt'], beforeApply['unrelated-user-record.txt']);
  const unchanged = await installReportingCompletion({ ...applied, apply: true, ackApiStopped: true });
  assert.equal(unchanged.status, 'UNCHANGED');
  assert.equal(unchanged.runtimeChanged, false);
  assert.deepEqual(await snapshot(applied.runtimeRoot), afterApply, 'Idempotent apply creates no duplicate ledger or backups');
  await assert.rejects(() => rollbackRelease({ ...applied, releaseId: result.releaseId }), /ack-api-stopped/);
  const rolledBack = await rollbackRelease({ ...applied, releaseId: result.releaseId, ackApiStopped: true });
  assert.equal(rolledBack.status, 'ROLLED_BACK');
  assert.equal(rolledBack.restoredFiles, 4);
  for (const [relative, hash] of Object.entries(beforeApply)) assert.equal(digest(await readFile(path.join(applied.runtimeRoot, relative))), hash);
  assert.equal(await exists(applied.runtimeRoot, expectedTargets[3]), false, 'Rollback removes only the new release helper');
  assert.equal((await rollbackRelease({ ...applied, releaseId: result.releaseId, ackApiStopped: true })).status, 'ALREADY_ROLLED_BACK');

  const failing = await fixture();
  const beforeFailure = await snapshot(failing.runtimeRoot);
  await assert.rejects(() => installReportingCompletion({ ...failing, apply: true, ackApiStopped: true,
    beforePromote(_entry, index) { if (index === 3) throw new Error('Isolated controlled promotion failure'); }
  }), /3 promoted file\(s\) rolled back/);
  for (const [relative, hash] of Object.entries(beforeFailure)) assert.equal(digest(await readFile(path.join(failing.runtimeRoot, relative))), hash);
  assert.equal(await exists(failing.runtimeRoot, expectedTargets[3]), false);
  assert.equal(await exists(failing.runtimeRoot, '.platform-consolidation.lock'), false);
  const [failureId] = await readdir(path.join(failing.runtimeRoot, 'var/platform-releases'));
  assert.equal(JSON.parse(await readFile(path.join(failing.runtimeRoot, `var/platform-releases/${failureId}/release.json`), 'utf8')).status, 'ROLLED_BACK');

  for (const missing of manifest.requiredFiles) {
    const invalid = await fixture();
    await unlink(path.join(invalid.runtimeRoot, missing));
    const before = await snapshot(invalid.runtimeRoot);
    await assert.rejects(() => installReportingCompletion({ ...invalid, apply: true, ackApiStopped: true }), { code: 'ENOENT' });
    assert.deepEqual(await snapshot(invalid.runtimeRoot), before, `${missing}: missing prerequisite fails before any runtime mutation`);
  }
  for (const binding of ['reportingContractRoutes', 'researchReportRoutes']) {
    const invalid = await fixture();
    await write(invalid.runtimeRoot, 'src/server.js', server.replace(`app.use("/api", ${binding});`, `/* app.use("/api", ${binding}); */`));
    const before = await snapshot(invalid.runtimeRoot);
    await assert.rejects(() => installReportingCompletion({ ...invalid, apply: true, ackApiStopped: true }), /server registration is missing/);
    assert.deepEqual(await snapshot(invalid.runtimeRoot), before, 'A commented-out mount cannot pass preflight or cause a server patch');
  }

  const cli = await fixture();
  const beforeCli = await snapshot(cli.runtimeRoot);
  const cliPath = path.join(here, 'install-reporting-completion.mjs');
  const defaultCli = await exec(process.execPath, [cliPath, cli.runtimeRoot]);
  assert.match(defaultCli.stdout, /"status": "DRY_RUN"/);
  assert.match(defaultCli.stdout, /No SQL, provider update, Quick publication or service restart performed/);
  assert.deepEqual(await snapshot(cli.runtimeRoot), beforeCli);
  for (const flags of [
    ['--apply'], ['--unsupported'], ['--dry-run', '--apply'], ['--apply', '--apply', '--ack-api-stopped'],
    ['--rollback', 'not-authorized-by-this-wrapper']
  ]) {
    await assert.rejects(() => exec(process.execPath, [cliPath, cli.runtimeRoot, ...flags]), (error) =>
      error.code === 1 && /Usage:|ack-api-stopped/.test(error.stderr));
    assert.deepEqual(await snapshot(cli.runtimeRoot), beforeCli, `Rejected CLI ${flags.join(' ')} causes no runtime edit`);
  }
  console.log('Reporting-completion real-wrapper dry-run, exact four-file promotion, durable dated backups, acknowledgement, idempotency, rollback, prerequisites, route guards and rejected CLI tests passed.');
} finally {
  // Only exact mkdtemp roots created by this test are removed.
  for (const root of roots) await rm(root, { recursive: true, force: true });
}
