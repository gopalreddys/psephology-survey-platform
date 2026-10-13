import { copyFile, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const marker = 'CALL_QUALITY_REVIEW_V1';
export const runtimeDependencies = [
  'src/db/postgres.js', 'src/middleware/auth.middleware.js', 'src/middleware/role.middleware.js',
  'src/repositories/campaign-visibility.repository.js',
  'src/repositories/analytics-workspace.repository.js',
  'src/repositories/output-normalization.repository.js',
  'src/repositories/normalization-rules.json'
];
const fileMappings = [
  ['call-quality-review.js', 'src/repositories/call-quality-review.js'],
  ['call-quality-review.repository.js', 'src/repositories/call-quality-review.repository.js'],
  ['call-quality-review.routes.js', 'src/routes/call-quality-review.routes.js'],
  ['033_call_quality_review.sql', 'sql/033_call_quality_review.sql'],
  ['migrate-call-quality-review.js', 'src/db/migrate-call-quality-review.js']
];

export async function installCallQualityReview(runtimeRoot, { dryRun = false } = {}) {
  if (typeof runtimeRoot !== 'string' || !path.isAbsolute(runtimeRoot)) {
    throw new Error('An absolute application runtime directory is required');
  }
  const root = await realpath(runtimeRoot);
  if (root === path.parse(root).root) throw new Error('An application runtime directory is required');
  const serverPath = path.join(root, 'src/server.js');
  const original = await readFile(serverPath, 'utf8');
  const importAnchor = /import\s+votersRoutes\s+from\s+["']\.\/routes\/voters\.routes\.js["'];/m;
  const mountAnchor = /app\.use\(\s*["']\/api["']\s*,\s*votersRoutes\s*\);/m;
  const importLine = 'import callQualityReviewRoutes from "./routes/call-quality-review.routes.js";';
  const mountLine = 'app.use("/api", callQualityReviewRoutes);';
  if (!importAnchor.test(original) || !mountAnchor.test(original)) {
    throw new Error('Expected API route anchors were not found; no files were installed');
  }
  const registered = original.includes(marker);
  if ((registered && (!original.includes(importLine) || !original.includes(mountLine)))
    || (!registered && /callQualityReviewRoutes|call-quality-review\.routes/.test(original))) {
    throw new Error('Call-quality registration is incomplete or unrecognized; review the server before installation');
  }
  if (registered && original.indexOf(mountLine) > original.search(mountAnchor)) {
    throw new Error('Call-quality routes must precede the legacy catalogue router; no files were installed');
  }
  // Read and syntax-check the complete package and prerequisites before any write.
  const files = [];
  for (const [sourceName, targetName] of fileMappings) {
    const source = path.join(here, sourceName);
    const contents = await readFile(source);
    if (sourceName.endsWith('.js')) execFileSync(process.execPath, ['--check', source]);
    files.push({ source, target: path.join(root, targetName), contents });
  }
  for (const dependency of runtimeDependencies) await readFile(path.join(root, dependency));
  const server = registered ? original : original
    .replace(importAnchor, (anchor) => `${anchor}\n/* ${marker} */\n${importLine}`)
    // Matching endpoints authorize themselves before broad legacy catalogue guards.
    .replace(mountAnchor, (anchor) => `/* ${marker} */\n${mountLine}\n${anchor}`);
  const result = { dryRun, files: files.map(({ target }) => target), serverChanged: server !== original };
  if (dryRun) return result;
  const stamp = `${Date.now()}-${randomUUID()}`;
  for (const { source, target, contents } of files) {
    let previous;
    try { previous = await readFile(target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (previous?.equals(contents)) continue;
    await mkdir(path.dirname(target), { recursive: true });
    if (previous) await copyFile(target, `${target}.bak-call-quality-review-${stamp}`);
    await copyFile(source, target);
  }
  if (server !== original) {
    await copyFile(serverPath, `${serverPath}.bak-call-quality-review-${stamp}`);
    await writeFile(serverPath, server);
  }
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await installCallQualityReview(process.argv[2] || '/opt/sarvam-voice-analytics', {
    dryRun: process.argv.includes('--dry-run')
  });
  console.log(result.dryRun ? 'Call-quality installation preflight passed; no files changed.' : 'Installed call-quality review runtime files.');
  console.log('No calls, approvals, historical backfills, database migrations or service restarts were performed.');
  console.log('Through the approved release process, migrate src/db/migrate-call-quality-review.js before restarting the API and deploy the matching frontend.');
}
