import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { installCallQualityReview, runtimeDependencies } from './install-call-quality-review.js';
import { migrateCallQualityReview } from './migrate-call-quality-review.js';

// Only disposable fixture directories created here are modified or removed.
const sandbox = await mkdtemp(path.join(os.tmpdir(), 'call-quality-installer-'));
const original = `import express from 'express';
import votersRoutes from './routes/voters.routes.js';
const app = express();
app.use('/api', votersRoutes);
app.listen(3000);
`;
async function fixture(name, server = original, skip = null) {
  const root = path.join(sandbox, name);
  await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(path.join(root, 'src/server.js'), server);
  for (const file of runtimeDependencies.filter((item) => item !== skip)) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), file.endsWith('.json') ? '{}' : '// isolated dependency fixture\n');
  }
  return root;
}
try {
  const root = await fixture('valid');
  const dry = await installCallQualityReview(root, { dryRun: true });
  assert.equal(dry.dryRun, true);
  assert.equal(dry.files.length, 5);
  assert.equal(dry.serverChanged, true);
  assert.equal(await readFile(path.join(root, 'src/server.js'), 'utf8'), original);
  assert.ok(!(await readdir(path.join(root, 'src/repositories'))).includes('call-quality-review.js'));
  const first = await installCallQualityReview(root);
  const patched = await readFile(path.join(root, 'src/server.js'), 'utf8');
  assert.ok(patched.indexOf('app.use("/api", callQualityReviewRoutes)') < patched.indexOf("app.use('/api', votersRoutes)"));
  for (const file of first.files) assert.ok((await readFile(file, 'utf8')).length > 0);
  assert.equal((await readdir(path.join(root, 'src'))).filter((name) => name.includes('.bak-call-quality-review-')).length, 1);
  const second = await installCallQualityReview(root);
  assert.equal(second.serverChanged, false);
  assert.equal((patched.match(/app.use\("\/api", callQualityReviewRoutes\)/g) || []).length, 1);
  const target = path.join(root, 'src/repositories/call-quality-review.js');
  await writeFile(target, '// existing module kept in backup\n');
  await installCallQualityReview(root);
  const backup = (await readdir(path.dirname(target))).find((name) => name.startsWith('call-quality-review.js.bak-call-quality-review-'));
  assert.equal(await readFile(path.join(path.dirname(target), backup), 'utf8'), '// existing module kept in backup\n');
  for (const [name, server, missing] of [
    ['no-anchor', 'const app = {};\n', null],
    ['no-normalizer', original, 'src/repositories/output-normalization.repository.js'],
    ['no-visibility', original, 'src/repositories/campaign-visibility.repository.js'],
    ['partial-marker', `${original}\n/* CALL_QUALITY_REVIEW_V1 */\n`, null],
    ['unrecognized-registration', `${original}\nimport x from './routes/call-quality-review.routes.js';\n`, null],
    ['late-mount', `${original}\n/* CALL_QUALITY_REVIEW_V1 */\nimport callQualityReviewRoutes from "./routes/call-quality-review.routes.js";\napp.use("/api", callQualityReviewRoutes);\n`, null]
  ]) {
    const bad = await fixture(name, server, missing);
    await assert.rejects(installCallQualityReview(bad));
    assert.equal(await readFile(path.join(bad, 'src/server.js'), 'utf8'), server);
    assert.ok(!(await readdir(path.join(bad, 'src/repositories'))).includes('call-quality-review.js'));
  }
  await assert.rejects(installCallQualityReview('/'), /runtime directory/);
  await assert.rejects(installCallQualityReview('.'), /absolute/);
  const calls = [];
  let released = false;
  const db = { connect: async () => ({ query: async (sql) => { calls.push(sql); }, release: () => { released = true; } }) };
  await migrateCallQualityReview(db, '-- isolated fixture SQL');
  assert.deepEqual(calls, ['BEGIN', '-- isolated fixture SQL', 'COMMIT']);
  assert.equal(released, true);
  calls.length = 0; released = false;
  db.connect = async () => ({ query: async (sql) => { calls.push(sql); if (sql === 'invalid SQL') throw new Error('synthetic migration failure'); }, release: () => { released = true; } });
  await assert.rejects(migrateCallQualityReview(db, 'invalid SQL'), /synthetic migration failure/);
  assert.deepEqual(calls, ['BEGIN', 'invalid SQL', 'ROLLBACK']);
  assert.equal(released, true);
  console.log('Call-quality installer/migration tests passed: preflight, mount order, dry-run, backups, idempotency and transaction rollback.');
} finally {
  await rm(sandbox, { recursive: true, force: true });
}
