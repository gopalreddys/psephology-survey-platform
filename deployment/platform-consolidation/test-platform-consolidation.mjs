import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rename, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { installRelease, preflightRelease, rollbackRelease } from './install-platform-consolidation.mjs';

const roots = [];
const write = async (root, relative, text) => { await mkdir(path.dirname(path.join(root, relative)), { recursive: true }); await writeFile(path.join(root, relative), text); };
const exists = async (root, relative) => readFile(path.join(root, relative)).then(() => true, (error) => { if (error.code === 'ENOENT') return false; throw error; });
async function fixture() {
  const base = await mkdtemp(path.join(tmpdir(), 'psephology-consolidation-test-'));
  roots.push(base);
  const runtimeRoot = path.join(base, 'runtime'), sourceRoot = path.join(base, 'source');
  await mkdir(runtimeRoot); await mkdir(sourceRoot);
  await write(runtimeRoot, 'package.json', '{"type":"module"}\n');
  await write(runtimeRoot, 'src/server.js', 'import routes from "./routes/test.routes.js";\nconst app = {use(){}};\napp.use("/api", routes);\n');
  await write(runtimeRoot, 'src/routes/test.routes.js', 'export default {};\n');
  await write(runtimeRoot, 'src/repositories/a.js', 'export const value = "old-a";\n');
  await write(runtimeRoot, 'src/repositories/b.js', 'export const value = "old-b";\n');
  await write(sourceRoot, 'deployment/test/a.js', 'import {helper} from "./helper.js";\nexport const value = helper;\n');
  await write(sourceRoot, 'deployment/test/helper.js', 'import {createHash} from "node:crypto";\nexport const helper = createHash("sha256").update("new").digest("hex");\n');
  await write(sourceRoot, 'deployment/test/b.js', 'export const value = "new-b";\n');
  const manifest = { schemaVersion: 1, releaseVersion: 'CONSOLIDATION_TEST_V1', requiredPackages: [], requiredMounts: [{ binding: 'routes', module: './routes/test.routes.js', prefix: '/api' }], files: [
    { source: 'deployment/test/a.js', target: 'src/repositories/a.js' },
    { source: 'deployment/test/helper.js', target: 'src/repositories/helper.js', allowNew: true },
    { source: 'deployment/test/b.js', target: 'src/repositories/b.js' }
  ] };
  return { runtimeRoot, sourceRoot, manifest };
}
const oldSnapshot = async (options) => [await readFile(path.join(options.runtimeRoot, 'src/repositories/a.js'), 'utf8'), await readFile(path.join(options.runtimeRoot, 'src/repositories/b.js'), 'utf8')];
try {
  const clean = await fixture();
  const old = await oldSnapshot(clean);
  const plan = await installRelease(clean);
  assert.equal(plan.status, 'DRY_RUN'); assert.equal(plan.runtimeChanged, false); assert.equal(plan.changedFiles.length, 3);
  assert.equal(plan.checkedModules, 4); // three planned modules and the mounted route
  assert.deepEqual(await oldSnapshot(clean), old);
  assert.equal(await exists(clean.runtimeRoot, 'src/repositories/helper.js'), false);
  assert.deepEqual((await readdir(clean.runtimeRoot)).sort(), ['package.json', 'src'], 'dry run creates no target metadata or staging files');
  await assert.rejects(installRelease({ ...clean, apply: true }), /ack-api-stopped/);
  assert.deepEqual(await oldSnapshot(clean), old);

  const missingExisting = await fixture();
  await unlink(path.join(missingExisting.runtimeRoot, 'src/repositories/b.js'));
  await assert.rejects(installRelease({ ...missingExisting, apply: true, ackApiStopped: true }), { code: 'ENOENT' });
  assert.equal(await readFile(path.join(missingExisting.runtimeRoot, 'src/repositories/a.js'), 'utf8'), old[0], 'all targets are preflighted before the first copy');

  const missingModule = await fixture();
  await write(missingModule.sourceRoot, 'deployment/test/helper.js', 'import {missing} from "./not-installed.js";\nexport const helper = missing;\n');
  await assert.rejects(installRelease({ ...missingModule, apply: true, ackApiStopped: true }), { code: 'ENOENT' });
  assert.deepEqual(await oldSnapshot(missingModule), old);

  const missingSql = await fixture();
  missingSql.manifest.requiredFiles = ['sql/032_sentiment_construct_reporting.sql'];
  await assert.rejects(installRelease({ ...missingSql, apply: true, ackApiStopped: true }), { code: 'ENOENT' });
  assert.deepEqual(await oldSnapshot(missingSql), old, 'migration assets are checked before runtime edits');
  await write(missingSql.runtimeRoot, 'sql/032_sentiment_construct_reporting.sql', '-- prerelease asset\n');
  assert.equal((await installRelease(missingSql)).status, 'DRY_RUN');

  const missingJson = await fixture();
  await write(missingJson.sourceRoot, 'deployment/test/helper.js', 'import {readFileSync} from "node:fs";\nexport const helper = JSON.parse(readFileSync(new URL("./rules.json", import.meta.url), "utf8"));\n');
  await assert.rejects(installRelease(missingJson), { code: 'ENOENT' });
  await write(missingJson.runtimeRoot, 'src/repositories/rules.json', '{broken');
  await assert.rejects(installRelease(missingJson), SyntaxError);
  await write(missingJson.runtimeRoot, 'src/repositories/rules.json', '{}');
  assert.equal((await installRelease(missingJson)).status, 'DRY_RUN');

  const missingPackage = await fixture();
  missingPackage.manifest.requiredPackages = ['@aws-sdk/client-quicksight'];
  await assert.rejects(preflightRelease(missingPackage), /Required installed runtime package is missing/);
  await write(missingPackage.runtimeRoot, 'node_modules/@aws-sdk/client-quicksight/package.json', '{"name":"@aws-sdk/client-quicksight","main":"index.js"}');
  await write(missingPackage.runtimeRoot, 'node_modules/@aws-sdk/client-quicksight/index.js', 'module.exports = {};');
  assert.deepEqual((await installRelease(missingPackage)).checkedPackages, ['@aws-sdk/client-quicksight']);

  const syntax = await fixture();
  await write(syntax.sourceRoot, 'deployment/test/b.js', 'export const = ;\n');
  await assert.rejects(installRelease({ ...syntax, apply: true, ackApiStopped: true }), /Command failed/);
  assert.deepEqual(await oldSnapshot(syntax), old);
  assert.equal(await exists(syntax.runtimeRoot, 'src/repositories/helper.js'), false);

  const mounts = await fixture();
  await write(mounts.runtimeRoot, 'src/server.js', 'import routes from "./routes/test.routes.js";\n/* app.use("/api", routes); */\n');
  await assert.rejects(installRelease(mounts), /server registration is missing/);
  assert.deepEqual(await oldSnapshot(mounts), old);

  const escaping = await fixture();
  escaping.manifest.files[0].target = '../outside.js';
  await assert.rejects(installRelease(escaping), /Invalid target relative path/);
  const sourceLink = await fixture();
  await rename(path.join(sourceLink.sourceRoot, 'deployment/test/a.js'), path.join(sourceLink.sourceRoot, 'deployment/test/actual-a.js'));
  await symlink(path.join(sourceLink.sourceRoot, 'deployment/test/actual-a.js'), path.join(sourceLink.sourceRoot, 'deployment/test/a.js'));
  await assert.rejects(installRelease(sourceLink), /Symlink is not permitted/);
  const targetLink = await fixture();
  await rename(path.join(targetLink.runtimeRoot, 'src/repositories'), path.join(targetLink.runtimeRoot, 'preserved-repositories'));
  await symlink(path.join(targetLink.runtimeRoot, 'preserved-repositories'), path.join(targetLink.runtimeRoot, 'src/repositories'));
  await assert.rejects(installRelease(targetLink), /Symlink is not permitted/);
  assert.equal(await readFile(path.join(targetLink.runtimeRoot, 'preserved-repositories/a.js'), 'utf8'), old[0]);

  const applied = await fixture();
  const result = await installRelease({ ...applied, apply: true, ackApiStopped: true });
  assert.equal(result.status, 'COMMITTED'); assert.equal(result.runtimeChanged, true);
  assert.equal(await exists(applied.runtimeRoot, 'src/repositories/helper.js'), true);
  const ledger = JSON.parse(await readFile(path.join(applied.runtimeRoot, result.ledger), 'utf8'));
  assert.equal(ledger.status, 'COMMITTED'); assert.equal(ledger.files.length, 3); assert.equal(ledger.manifestHash, result.manifestHash);
  assert.equal(await readFile(path.join(applied.runtimeRoot, `var/platform-releases/${result.releaseId}/backups/src/repositories/a.js`), 'utf8'), old[0], 'recoverable original is retained with the release ledger');
  const unchanged = await installRelease({ ...applied, apply: true, ackApiStopped: true });
  assert.equal(unchanged.status, 'UNCHANGED'); assert.equal(unchanged.runtimeChanged, false);
  assert.equal((await readdir(path.join(applied.runtimeRoot, 'var/platform-releases'))).length, 1, 'idempotent apply does not create duplicate releases');
  await assert.rejects(rollbackRelease({ runtimeRoot: applied.runtimeRoot, releaseId: result.releaseId }), /ack-api-stopped/);
  const rollback = await rollbackRelease({ runtimeRoot: applied.runtimeRoot, releaseId: result.releaseId, ackApiStopped: true });
  assert.equal(rollback.status, 'ROLLED_BACK'); assert.deepEqual(await oldSnapshot(applied), old);
  assert.equal(await exists(applied.runtimeRoot, 'src/repositories/helper.js'), false);
  assert.equal((await rollbackRelease({ runtimeRoot: applied.runtimeRoot, releaseId: result.releaseId, ackApiStopped: true })).status, 'ALREADY_ROLLED_BACK');

  const failed = await fixture();
  await assert.rejects(installRelease({ ...failed, apply: true, ackApiStopped: true, beforePromote(_, index) { if (index === 2) throw new Error('Controlled promotion failure'); } }), /2 promoted file\(s\) rolled back/);
  assert.deepEqual(await oldSnapshot(failed), old); assert.equal(await exists(failed.runtimeRoot, 'src/repositories/helper.js'), false);
  const [failedId] = await readdir(path.join(failed.runtimeRoot, 'var/platform-releases'));
  const failedLedger = JSON.parse(await readFile(path.join(failed.runtimeRoot, `var/platform-releases/${failedId}/release.json`), 'utf8'));
  assert.equal(failedLedger.status, 'ROLLED_BACK'); assert.equal(failedLedger.promotedTargets.length, 2);
  assert.equal(await exists(failed.runtimeRoot, '.platform-consolidation.lock'), false);

  const edited = await fixture();
  const editedResult = await installRelease({ ...edited, apply: true, ackApiStopped: true });
  await write(edited.runtimeRoot, 'src/repositories/b.js', 'export const value = "later user change";\n');
  await assert.rejects(rollbackRelease({ runtimeRoot: edited.runtimeRoot, releaseId: editedResult.releaseId, ackApiStopped: true }), /Refusing to overwrite a later runtime change/);
  assert.equal(await readFile(path.join(edited.runtimeRoot, 'src/repositories/a.js'), 'utf8'), await readFile(path.join(edited.sourceRoot, 'deployment/test/a.js'), 'utf8'), 'rollback validates every target before its first restore');

  const controlled = JSON.parse(await readFile(new URL('./release-manifest.json', import.meta.url), 'utf8'));
  assert.equal(controlled.files.filter((item) => item.target === 'src/repositories/quick-embed-access.js').length, 1);
  assert.equal(controlled.files.filter((item) => item.target === 'src/repositories/operational-lifecycle-policy.js').length, 1);
  assert.equal(controlled.files.filter((item) => item.target === 'src/repositories/research-scope.repository.js').length, 1);
  assert.ok(controlled.requiredPackages.includes('@aws-sdk/client-quicksight'));
  for (const entry of controlled.files) await readFile(new URL(`../../${entry.source}`, import.meta.url));
  console.log('Release manifest, dry-run containment/dependency/syntax/mount checks, atomic promotion, failure rollback, recoverable backups and idempotency tests passed.');
} finally {
  // All roots are exact mkdtemp results created by this test, never user/runtime directories.
  for (const root of roots) await rm(root, { recursive: true, force: true });
}
