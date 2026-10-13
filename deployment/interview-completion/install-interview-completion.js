import { copyFile, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const marker = 'INTERVIEW_COMPLETENESS_V1';
export const runtimeDependencies = [
  'src/db/postgres.js', 'src/middleware/auth.middleware.js', 'src/middleware/role.middleware.js',
  'src/repositories/campaign-visibility.repository.js',
  'src/repositories/analytics-workspace.repository.js'
];
const fileMappings = [
  ['interview-completion.js', 'src/repositories/interview-completion.js'],
  ['interview-completion.repository.js', 'src/repositories/interview-completion.repository.js'],
  ['interview-completion.routes.js', 'src/routes/interview-completion.routes.js']
];

export async function installInterviewCompletion(runtimeRoot, { dryRun = false } = {}) {
  if (typeof runtimeRoot !== 'string' || !path.isAbsolute(runtimeRoot)) {
    throw new Error('An absolute application runtime directory is required');
  }
  const root = await realpath(runtimeRoot);
  if (root === path.parse(root).root) throw new Error('An application runtime directory is required');
  const serverPath = path.join(root, 'src/server.js');
  const original = await readFile(serverPath, 'utf8');
  const importAnchor = /import\s+votersRoutes\s+from\s+["']\.\/routes\/voters\.routes\.js["'];/m;
  const mountAnchor = /app\.use\(\s*["']\/api["']\s*,\s*votersRoutes\s*\);/m;
  const importLine = 'import interviewCompletionRoutes from "./routes/interview-completion.routes.js";';
  const mountLine = 'app.use("/api", interviewCompletionRoutes);';
  if (original.match(new RegExp(importAnchor.source, 'gm'))?.length !== 1
    || original.match(new RegExp(mountAnchor.source, 'gm'))?.length !== 1) {
    throw new Error('Expected API route anchors were not found; no files were installed');
  }
  const registered = original.includes(marker);
  if ((registered && (!original.includes(importLine) || !original.includes(mountLine)))
    || (!registered && /interviewCompletionRoutes|interview-completion\.routes/.test(original))) {
    throw new Error('Interview-completeness registration is incomplete or unrecognized; review the server before installation');
  }
  if (registered && (original.split(importLine).length !== 2 || original.split(mountLine).length !== 2)) {
    throw new Error('Interview-completeness registration is duplicated; no files were installed');
  }
  if (registered && original.indexOf(mountLine) > original.search(mountAnchor)) {
    throw new Error('Interview-completeness routes must precede the legacy catalogue router; no files were installed');
  }
  // Read and check every source and prerequisite before touching runtime files.
  const files = [];
  for (const [sourceName, targetName] of fileMappings) {
    const source = path.join(here, sourceName);
    const contents = await readFile(source);
    execFileSync(process.execPath, ['--check', source]);
    files.push({ source, target: path.join(root, targetName), contents });
  }
  for (const dependency of runtimeDependencies) await readFile(path.join(root, dependency));
  const server = registered ? original : original
    .replace(importAnchor, (anchor) => `${anchor}\n/* ${marker} */\n${importLine}`)
    .replace(mountAnchor, (anchor) => `/* ${marker} */\n${mountLine}\n${anchor}`);
  const result = { dryRun, files: files.map(({ target }) => target), serverChanged: server !== original };
  if (dryRun) return result;
  const stamp = `${Date.now()}-${randomUUID()}`;
  for (const { source, target, contents } of files) {
    let previous;
    try { previous = await readFile(target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (previous?.equals(contents)) continue;
    await mkdir(path.dirname(target), { recursive: true });
    if (previous) await copyFile(target, `${target}.bak-interview-completion-${stamp}`);
    await copyFile(source, target);
  }
  if (server !== original) {
    await copyFile(serverPath, `${serverPath}.bak-interview-completion-${stamp}`);
    await writeFile(serverPath, server);
  }
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await installInterviewCompletion(process.argv[2] || '/opt/sarvam-voice-analytics', {
    dryRun: process.argv.includes('--dry-run')
  });
  console.log(result.dryRun ? 'Interview-completeness installation preflight passed; no files changed.' : 'Installed read-only interview-completeness runtime files.');
  console.log('No database migration, records, calls, historical classifications, lifecycle updates or service restarts were performed.');
  console.log('Restart the API and deploy the matching frontend only through the approved release process.');
}
