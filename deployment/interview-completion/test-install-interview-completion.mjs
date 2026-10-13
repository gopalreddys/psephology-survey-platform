import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { installInterviewCompletion, runtimeDependencies } from './install-interview-completion.js';

// These are disposable synthetic runtimes, not a deployed application.
const sandbox = await mkdtemp(path.join(os.tmpdir(), 'interview-completion-installer-'));
const original = `import express from 'express';
import votersRoutes from './routes/voters.routes.js';
/* CALL_QUALITY_REVIEW_V1 */
import callQualityReviewRoutes from './routes/call-quality-review.routes.js';
const app = express();
/* CALL_QUALITY_REVIEW_V1 */
app.use('/api', callQualityReviewRoutes);
app.use('/api', votersRoutes);
app.listen(3000);
`;
async function fixture(name, server = original, skip = null) {
  const root = path.join(sandbox, name);
  await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(path.join(root, 'src/server.js'), server);
  for (const file of runtimeDependencies.filter((item) => item !== skip)) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), '// isolated prerequisite fixture\n');
  }
  return root;
}
try {
  const root = await fixture('valid');
  const dry = await installInterviewCompletion(root, { dryRun: true });
  assert.equal(dry.dryRun, true);
  assert.equal(dry.files.length, 3);
  assert.equal(dry.serverChanged, true);
  assert.equal(await readFile(path.join(root, 'src/server.js'), 'utf8'), original);
  assert.ok(!(await readdir(path.join(root, 'src/repositories'))).includes('interview-completion.js'));
  const first = await installInterviewCompletion(root);
  const patched = await readFile(path.join(root, 'src/server.js'), 'utf8');
  assert.ok(patched.indexOf('app.use("/api", interviewCompletionRoutes)') < patched.indexOf("app.use('/api', votersRoutes)"));
  assert.ok(patched.includes("app.use('/api', callQualityReviewRoutes)"), 'Step 1 registration is preserved');
  for (const file of first.files) assert.ok((await readFile(file, 'utf8')).length > 0);
  assert.equal((await readdir(path.join(root, 'src'))).filter((name) => name.includes('.bak-interview-completion-')).length, 1);
  assert.equal((await installInterviewCompletion(root)).serverChanged, false);
  assert.equal((patched.match(/app.use\("\/api", interviewCompletionRoutes\)/g) || []).length, 1);
  const target = path.join(root, 'src/repositories/interview-completion.js');
  await writeFile(target, '// existing module kept in backup\n');
  await installInterviewCompletion(root);
  const backup = (await readdir(path.dirname(target))).find((name) => name.startsWith('interview-completion.js.bak-interview-completion-'));
  assert.equal(await readFile(path.join(path.dirname(target), backup), 'utf8'), '// existing module kept in backup\n');
  for (const [name, server, missing] of [
    ['no-anchor', 'const app = {};\n', null],
    ['no-visibility', original, 'src/repositories/campaign-visibility.repository.js'],
    ['no-analytics', original, 'src/repositories/analytics-workspace.repository.js'],
    ['duplicate-legacy-anchor', `${original}\napp.use('/api', votersRoutes);\n`, null],
    ['partial-marker', `${original}\n/* INTERVIEW_COMPLETENESS_V1 */\n`, null],
    ['unrecognized-registration', `${original}\nimport x from './routes/interview-completion.routes.js';\n`, null],
    ['late-mount', `${original}\n/* INTERVIEW_COMPLETENESS_V1 */\nimport interviewCompletionRoutes from "./routes/interview-completion.routes.js";\napp.use("/api", interviewCompletionRoutes);\n`, null],
    ['duplicate-registration', `${patched}\napp.use("/api", interviewCompletionRoutes);\n`, null]
  ]) {
    const bad = await fixture(name, server, missing);
    await assert.rejects(installInterviewCompletion(bad));
    assert.equal(await readFile(path.join(bad, 'src/server.js'), 'utf8'), server);
    assert.ok(!(await readdir(path.join(bad, 'src/repositories'))).includes('interview-completion.js'));
  }
  await assert.rejects(installInterviewCompletion('/'), /runtime directory/);
  await assert.rejects(installInterviewCompletion('.'), /absolute/);
  console.log('Interview-completeness installer tests passed: complete preflight, mount order, Step 1 preservation, dry-run, backups and idempotency.');
} finally {
  await rm(sandbox, { recursive: true, force: true });
}
