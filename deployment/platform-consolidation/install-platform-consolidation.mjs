import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { builtinModules, createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const here = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(here, '../..');
const exec = promisify(execFile);
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const escaped = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const builtins = new Set(builtinModules.map((name) => name.replace(/^node:/, '')));

function relativePath(value, label) {
  if (typeof value !== 'string' || !value || path.isAbsolute(value) || value.includes('\\') || value.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`Invalid ${label} relative path`);
  }
  return value;
}

async function checkedRoot(value, label) {
  const root = path.resolve(value);
  if (root === path.parse(root).root) throw new Error(`${label} must be a specific application directory`);
  const info = await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`${label} must be a real directory, not a symlink`);
  return realpath(root);
}

/** Reject symlinks on every relative component; never follow a file/directory escape. */
async function checkedPath(root, relative, { allowMissing = false, file = true } = {}) {
  relativePath(relative, 'runtime/source');
  const parts = relative.split('/');
  let current = root;
  for (let index = 0; index < parts.length; index += 1) {
    current = path.join(current, parts[index]);
    let info;
    try { info = await lstat(current); }
    catch (error) { if (error.code === 'ENOENT' && allowMissing) return current + (index < parts.length - 1 ? path.sep + parts.slice(index + 1).join(path.sep) : ''); throw error; }
    if (info.isSymbolicLink()) throw new Error(`Symlink is not permitted: ${relative}`);
    if (index < parts.length - 1 && !info.isDirectory()) throw new Error(`Expected directory: ${relative}`);
    if (index === parts.length - 1 && file && !info.isFile()) throw new Error(`Expected regular file: ${relative}`);
  }
  return current;
}

function validateManifest(manifest) {
  if (manifest?.schemaVersion !== 1 || !/^[A-Z0-9_]{8,80}$/.test(manifest.releaseVersion || '') || !Array.isArray(manifest.files) || !manifest.files.length) throw new Error('Invalid release manifest');
  const targets = new Set();
  for (const entry of manifest.files) {
    relativePath(entry.source, 'source'); relativePath(entry.target, 'target');
    if (!/^deployment\/.+\.(?:js|mjs|sql|json)$/.test(entry.source) || !/^(?:src\/(?:repositories|routes|db)\/.+\.(?:js|mjs|json)|sql\/.+\.sql)$/.test(entry.target)) throw new Error('Release files must stay within controlled deployment and runtime module paths');
    if (targets.has(entry.target)) throw new Error(`Duplicate release target: ${entry.target}`);
    if (entry.allowNew !== undefined && typeof entry.allowNew !== 'boolean') throw new Error('allowNew must be explicit boolean');
    targets.add(entry.target);
  }
  for (const mount of manifest.requiredMounts || []) {
    if (!/^\.\/routes\/[\w.-]+\.js$/.test(mount.module) || !/^[A-Za-z]\w*$/.test(mount.binding) || mount.prefix !== '/api') throw new Error('Invalid server mount requirement');
  }
}

function importSpecifiers(source) {
  // Controlled ES-module sources only; no module is executed during preflight.
  return [
    ...source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)["']([^"']+)["']/g),
    ...source.matchAll(/\bnew\s+URL\(\s*["']([^"']+\.json)["']\s*,\s*import\.meta\.url\s*\)/g)
  ].map((match) => match[1]);
}

export async function preflightRelease({ runtimeRoot, sourceRoot = repositoryRoot, manifest }) {
  validateManifest(manifest);
  const root = await checkedRoot(runtimeRoot, 'Runtime root');
  const source = await checkedRoot(sourceRoot, 'Source root');
  if (root === source) throw new Error('Runtime root must not be the source checkout');
  const packagePath = await checkedPath(root, 'package.json');
  const runtimePackage = JSON.parse(await readFile(packagePath, 'utf8'));
  if (runtimePackage.type !== 'module') throw new Error('The API runtime must declare type: module');
  const serverPath = await checkedPath(root, 'src/server.js');
  const server = await readFile(serverPath, 'utf8');
  const serverRegistration = server.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const mount of manifest.requiredMounts || []) {
    const imported = new RegExp(`import\\s+${escaped(mount.binding)}\\s+from\\s*["']${escaped(mount.module)}["']\\s*;`);
    const mounted = new RegExp(`app\\.use\\(\\s*["']${escaped(mount.prefix)}["']\\s*,\\s*${escaped(mount.binding)}\\s*\\)\\s*;`);
    if (!imported.test(serverRegistration) || !mounted.test(serverRegistration)) throw new Error(`Existing server registration is missing: ${mount.binding}. No server patch is performed by this release.`);
  }
  const files = [];
  for (const entry of manifest.files) {
    const sourcePath = await checkedPath(source, entry.source);
    const targetPath = await checkedPath(root, entry.target, { allowMissing: entry.allowNew === true });
    const contents = await readFile(sourcePath);
    let previous = null, mode = 0o644;
    try { previous = await readFile(targetPath); mode = (await lstat(targetPath)).mode & 0o777; }
    catch (error) { if (error.code !== 'ENOENT' || entry.allowNew !== true) throw error; }
    if (entry.target.endsWith('.json')) JSON.parse(contents.toString('utf8'));
    files.push({ ...entry, contents, previous, mode, sourceHash: sha256(contents), previousHash: previous === null ? null : sha256(previous), changed: previous === null || !previous.equals(contents) });
  }
  const planned = new Map(files.map((entry) => [entry.target, entry]));
  for (const relative of manifest.requiredFiles || []) {
    relativePath(relative, 'prerequisite');
    if (!planned.has(relative)) await checkedPath(root, relative);
  }
  const require = createRequire(packagePath);
  const installedPackages = new Set();
  function checkPackage(specifier) {
    const packageName = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
    if (installedPackages.has(specifier)) return;
    let resolved;
    try { resolved = require.resolve(specifier); }
    catch { throw new Error(`Required installed runtime package is missing or unresolved: ${packageName}`); }
    if (!resolved.startsWith(`${root}${path.sep}node_modules${path.sep}`)) throw new Error(`Runtime dependency must resolve inside this API's node_modules: ${packageName}`);
    installedPackages.add(specifier);
  }
  for (const name of manifest.requiredPackages || []) checkPackage(name);
  const visited = new Set();
  async function visit(relative) {
    if (visited.has(relative)) return;
    visited.add(relative);
    const entry = planned.get(relative);
    const body = entry?.contents || await readFile(await checkedPath(root, relative));
    if (relative.endsWith('.json')) JSON.parse(body.toString('utf8'));
    if (!/\.(?:js|mjs)$/.test(relative)) return;
    for (const specifier of importSpecifiers(body.toString('utf8'))) {
      if (specifier.startsWith('node:') || builtins.has(specifier)) {
        if (!builtins.has(specifier.replace(/^node:/, ''))) throw new Error(`Unknown Node builtin dependency: ${specifier}`);
      } else if (specifier.startsWith('.')) {
        const absolute = path.resolve(root, path.dirname(relative), specifier);
        if (!absolute.startsWith(`${root}${path.sep}`)) throw new Error(`Relative dependency escapes the runtime: ${relative}`);
        const dependency = path.relative(root, absolute).split(path.sep).join('/');
        if (!planned.has(dependency)) await checkedPath(root, dependency);
        await visit(dependency);
      } else {
        if (/^(?:\/|https?:|file:)/.test(specifier)) throw new Error(`Unsupported external module path: ${relative}`);
        checkPackage(specifier);
      }
    }
  }
  for (const entry of files) if (/\.(?:js|mjs)$/.test(entry.target)) await visit(entry.target);
  for (const mount of manifest.requiredMounts || []) await visit(`src/${mount.module.slice(2)}`);
  // Syntax checking takes place in an isolated temporary tree, including during dry run.
  const stage = await mkdtemp(path.join(tmpdir(), 'psephology-release-preflight-'));
  try {
    await writeFile(path.join(stage, 'package.json'), '{"type":"module"}\n');
    await mkdir(path.join(stage, 'src'), { recursive: true });
    await writeFile(path.join(stage, 'src/server.js'), server);
    await exec(process.execPath, ['--check', path.join(stage, 'src/server.js')]);
    for (const entry of files) {
      const stagedPath = path.join(stage, entry.target);
      await mkdir(path.dirname(stagedPath), { recursive: true });
      await writeFile(stagedPath, entry.contents);
      if (/\.(?:js|mjs)$/.test(entry.target)) await exec(process.execPath, ['--check', stagedPath]);
    }
  } finally { await rm(stage, { recursive: true, force: true }); }
  // No application target, metadata, backup or process has been changed at this point.
  await checkedPath(root, 'var/platform-releases', { allowMissing: true, file: false });
  const manifestHash = sha256(JSON.stringify({ manifest, hashes: files.map((entry) => [entry.target, entry.sourceHash]) }));
  return { root, sourceRoot: source, manifest, manifestHash, files, checkedModules: visited.size, checkedPackages: [...installedPackages].sort() };
}

async function atomicWrite(root, relative, contents, mode = 0o600) {
  const destination = await checkedPath(root, relative, { allowMissing: true });
  await mkdir(path.dirname(destination), { recursive: true });
  await checkedPath(root, path.relative(root, path.dirname(destination)).split(path.sep).join('/'), { file: false });
  const temporary = `${destination}.release-${randomUUID()}.tmp`;
  try { await writeFile(temporary, contents, { flag: 'wx', mode }); await rename(temporary, destination); }
  finally { await unlink(temporary).catch((error) => { if (error.code !== 'ENOENT') throw error; }); }
}

async function writeLedger(root, releaseId, ledger) {
  await atomicWrite(root, `var/platform-releases/${releaseId}/release.json`, JSON.stringify(ledger, null, 2) + '\n');
}

async function restoreEntries(root, releaseId, entries) {
  const failures = [];
  for (const entry of [...entries].reverse()) {
    try {
      if (entry.previousHash === null) {
        await unlink(await checkedPath(root, entry.target)).catch((error) => { if (error.code !== 'ENOENT') throw error; });
      } else {
        const backup = await readFile(await checkedPath(root, `var/platform-releases/${releaseId}/backups/${entry.target}`));
        if (sha256(backup) !== entry.previousHash) throw new Error(`Backup checksum failed: ${entry.target}`);
        await atomicWrite(root, entry.target, backup, entry.mode);
      }
    } catch (error) { failures.push(error); }
  }
  if (failures.length) throw new AggregateError(failures, 'Some release files could not be restored; all remaining restores were attempted.');
}

export async function installRelease(options) {
  const prepared = await preflightRelease(options);
  const { root, files, manifest, manifestHash } = prepared;
  const changed = files.filter((entry) => entry.changed);
  const summary = { releaseVersion: manifest.releaseVersion, manifestHash, changedFiles: changed.map((entry) => ({ target: entry.target, sourceHash: entry.sourceHash, previousHash: entry.previousHash })), checkedModules: prepared.checkedModules, checkedPackages: prepared.checkedPackages };
  if (!options.apply) return { ...summary, status: 'DRY_RUN', runtimeChanged: false };
  if (!options.ackApiStopped) throw new Error('Multi-file promotion requires --ack-api-stopped after the operator stops the API and other deployment tools. No service is stopped by this installer.');
  if (!changed.length) return { ...summary, status: 'UNCHANGED', runtimeChanged: false };
  const lockRelative = '.platform-consolidation.lock';
  const lock = path.join(root, lockRelative);
  await writeFile(lock, `${process.pid}\n`, { flag: 'wx', mode: 0o600 });
  const releaseId = `${manifest.releaseVersion}-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`;
  const promoted = [];
  let ledger = { schemaVersion: 1, releaseId, releaseVersion: manifest.releaseVersion, manifestHash, status: 'PREPARED', createdAt: new Date().toISOString(), apiStoppedAcknowledged: true, files: changed.map(({ target, sourceHash, previousHash, mode }) => ({ target, sourceHash, previousHash, mode })), promotedTargets: [] };
  try {
    // Reject a concurrent edit between preflight and promotion instead of overwriting it.
    for (const entry of files) {
      const destination = await checkedPath(root, entry.target, { allowMissing: entry.previousHash === null });
      const current = await readFile(destination).catch((error) => { if (error.code === 'ENOENT') return null; throw error; });
      if ((current === null ? null : sha256(current)) !== entry.previousHash) throw new Error(`Runtime changed after preflight: ${entry.target}`);
      const source = await readFile(await checkedPath(prepared.sourceRoot, entry.source));
      if (sha256(source) !== entry.sourceHash) throw new Error(`Release source changed after preflight: ${entry.source}`);
    }
    await writeLedger(root, releaseId, ledger);
    for (const entry of changed) if (entry.previous !== null) {
      const backupRelative = `var/platform-releases/${releaseId}/backups/${entry.target}`;
      await atomicWrite(root, backupRelative, entry.previous, 0o600);
      if (sha256(await readFile(await checkedPath(root, backupRelative))) !== entry.previousHash) throw new Error(`Backup checksum failed: ${entry.target}`);
    }
    for (const [index, entry] of changed.entries()) {
      await options.beforePromote?.(entry, index); // Test/in-process hook; there is no CLI failure-injection flag.
      await atomicWrite(root, entry.target, entry.contents, entry.mode);
      promoted.push(entry);
      ledger.promotedTargets = promoted.map((item) => item.target);
      await writeLedger(root, releaseId, ledger);
    }
    ledger.status = 'COMMITTED'; ledger.completedAt = new Date().toISOString();
    await writeLedger(root, releaseId, ledger);
    return { ...summary, status: 'COMMITTED', releaseId, ledger: `var/platform-releases/${releaseId}/release.json`, runtimeChanged: true };
  } catch (failure) {
    try {
      await restoreEntries(root, releaseId, promoted);
      ledger.status = 'ROLLED_BACK'; ledger.failedAt = new Date().toISOString();
      await writeLedger(root, releaseId, ledger);
    } catch (rollbackFailure) {
      ledger.status = 'ROLLBACK_FAILED'; ledger.failedAt = new Date().toISOString();
      await writeLedger(root, releaseId, ledger).catch(() => {});
      throw new AggregateError([failure, rollbackFailure], `Release failed and rollback needs operator attention. Recoverable backups: var/platform-releases/${releaseId}`);
    }
    throw new Error(`Release failed; ${promoted.length} promoted file(s) rolled back. Ledger: var/platform-releases/${releaseId}/release.json`, { cause: failure });
  } finally { await unlink(lock); }
}

export async function rollbackRelease({ runtimeRoot, releaseId, ackApiStopped = false }) {
  if (!ackApiStopped) throw new Error('Rollback also requires --ack-api-stopped');
  if (typeof releaseId !== 'string' || !/^[A-Z0-9_]+-\d{4}-\d{2}-\d{2}T[\dTZ-]+-[a-f0-9-]{36}$/.test(releaseId)) throw new Error('Invalid exact release ID');
  const root = await checkedRoot(runtimeRoot, 'Runtime root');
  const ledger = JSON.parse(await readFile(await checkedPath(root, `var/platform-releases/${releaseId}/release.json`), 'utf8'));
  if (ledger.releaseId !== releaseId || ledger.schemaVersion !== 1 || !Array.isArray(ledger.files)) throw new Error('Invalid rollback ledger');
  if (ledger.status === 'ROLLED_BACK') return { status: 'ALREADY_ROLLED_BACK', releaseId };
  if (ledger.status !== 'COMMITTED') throw new Error('Incomplete release requires operator review; do not blindly overwrite files');
  const lock = path.join(root, '.platform-consolidation.lock');
  await writeFile(lock, `${process.pid}\n`, { flag: 'wx', mode: 0o600 });
  let restoring = false;
  try {
    // Preflight the complete rollback under the release lock before its first restore.
    for (const entry of ledger.files) {
      relativePath(entry.target, 'rollback target');
      if (!/^(?:src\/(?:repositories|routes|db)\/.+\.(?:js|mjs|json)|sql\/.+\.sql)$/.test(entry.target)) throw new Error('Uncontrolled rollback target');
      if (!/^[a-f0-9]{64}$/.test(entry.sourceHash) || (entry.previousHash !== null && !/^[a-f0-9]{64}$/.test(entry.previousHash)) || !Number.isInteger(entry.mode) || entry.mode < 0 || entry.mode > 0o777) throw new Error('Invalid rollback checksums or file mode');
      const current = await readFile(await checkedPath(root, entry.target));
      if (sha256(current) !== entry.sourceHash) throw new Error(`Refusing to overwrite a later runtime change: ${entry.target}`);
      if (entry.previousHash !== null) {
        const backup = await readFile(await checkedPath(root, `var/platform-releases/${releaseId}/backups/${entry.target}`));
        if (sha256(backup) !== entry.previousHash) throw new Error(`Backup checksum failed: ${entry.target}`);
      }
    }
    restoring = true;
    await restoreEntries(root, releaseId, ledger.files);
    ledger.status = 'ROLLED_BACK'; ledger.rolledBackAt = new Date().toISOString();
    await writeLedger(root, releaseId, ledger);
    return { status: 'ROLLED_BACK', releaseId, restoredFiles: ledger.files.length };
  } catch (failure) {
    if (restoring) {
      ledger.status = 'ROLLBACK_FAILED'; ledger.failedAt = new Date().toISOString();
      await writeLedger(root, releaseId, ledger).catch(() => {});
    }
    throw failure;
  } finally { await unlink(lock); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    const runtimeRoot = args[0] && !args[0].startsWith('--') ? args.shift() : '/opt/sarvam-voice-analytics';
    const unknown = args.filter((value, index) => !['--apply', '--dry-run', '--ack-api-stopped', '--rollback'].includes(value) && args[index - 1] !== '--rollback');
    if (unknown.length || (args.includes('--apply') && args.includes('--dry-run')) || (args.includes('--rollback') && (args.includes('--apply') || args.includes('--dry-run')))) throw new Error('Usage: node install-platform-consolidation.mjs [runtime-root] [--apply --ack-api-stopped | --rollback exact-release-id --ack-api-stopped]');
    const rollbackIndex = args.indexOf('--rollback');
    const result = rollbackIndex >= 0
      ? await rollbackRelease({ runtimeRoot, releaseId: args[rollbackIndex + 1], ackApiStopped: args.includes('--ack-api-stopped') })
      : await installRelease({ runtimeRoot, manifest: JSON.parse(await readFile(path.join(here, 'release-manifest.json'), 'utf8')), apply: args.includes('--apply'), ackApiStopped: args.includes('--ack-api-stopped') });
    console.log(JSON.stringify(result, null, 2));
    console.log('No service restarts, SQL execution, historical backfills, calls, frontend deployment or AWS publication/refresh were performed.');
  } catch (error) {
    console.error(error.message);
    if (error.cause) console.error(error.cause.message);
    process.exitCode = 1;
  }
}
