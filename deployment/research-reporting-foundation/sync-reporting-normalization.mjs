import { createHash } from 'node:crypto';
import { open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
// The same source is installed into src/db by the bounded reporting release.
// Both imports resolve locally; the installed database adapter is CLI-only.
const location = path.dirname(fileURLToPath(import.meta.url));
const installed = path.basename(location) === 'db' && path.basename(path.dirname(location)) === 'src';
const { buildNormalizationSqlFunction, SENTIMENT_RULESET_HASH } = await import(new URL(installed
  ? '../repositories/output-normalization.repository.js'
  : '../output-variable-standardization/output-normalization.repository.js', import.meta.url).href);

const SIGNATURE = 'public.analytics_normalize_output_v1(text,jsonb)';
const HEX = /^[a-f0-9]{64}$/;
const hash = (value) => createHash('sha256').update(value).digest('hex');
const metadataFields = ['oid', 'owner_oid', 'acl', 'security_definer', 'leakproof', 'volatility', 'parallel',
  'strict', 'returns_set', 'return_type_oid', 'argument_type_oids', 'all_argument_type_oids', 'argument_modes',
  'argument_names', 'kind', 'language_oid', 'configuration', 'default_argument_count', 'argument_defaults',
  'binary_path', 'cost', 'rows', 'support_function_oid'];
const inspectSql = `
  SELECT p.oid::text AS oid, pg_catalog.pg_get_functiondef(p.oid) AS definition, p.prosrc AS body,
    p.proowner::text AS owner_oid, p.proacl::text AS acl, p.prosecdef AS security_definer,
    p.proleakproof AS leakproof, p.provolatile AS volatility, p.proparallel AS parallel,
    p.proisstrict AS strict, p.proretset AS returns_set, p.prorettype::text AS return_type_oid,
    p.proargtypes::text AS argument_type_oids, p.proallargtypes::text AS all_argument_type_oids,
    p.proargmodes::text AS argument_modes, p.proargnames::text AS argument_names,
    p.prokind AS kind, p.prolang::text AS language_oid, p.proconfig::text AS configuration,
    p.pronargdefaults AS default_argument_count, p.proargdefaults::text AS argument_defaults,
    p.probin AS binary_path, p.procost AS cost, p.prorows AS rows, p.prosupport::text AS support_function_oid,
    language.lanname AS language_name
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_language language ON language.oid = p.prolang
  WHERE p.oid = pg_catalog.to_regprocedure($1)
`;

function fail(code) { throw Object.assign(new Error(code), { code }); }
function generatedBody() {
  const generated = buildNormalizationSqlFunction();
  const match = /^CREATE OR REPLACE FUNCTION analytics_normalize_output_v1\(output_key text, raw_value jsonb\)[\s\S]*?AS \$normalize\$([\s\S]*)\$normalize\$;\s*$/.exec(generated);
  if (!match || !match[1]) fail('NORMALIZER_BUILDER_UNSUPPORTED');
  return match[1];
}
function metadata(row) {
  if (!row || metadataFields.some((key) => !Object.hasOwn(row, key))) fail('NORMALIZER_METADATA_UNAVAILABLE');
  return Object.fromEntries(metadataFields.map((key) => [key, row[key]]));
}
async function inspect(client) {
  const result = await client.query(inspectSql, [SIGNATURE]);
  if (result.rows.length !== 1) fail('NORMALIZER_FUNCTION_NOT_FOUND');
  const row = result.rows[0];
  metadata(row);
  if (typeof row.definition !== 'string' || typeof row.body !== 'string'
      || row.language_name !== 'plpgsql' || row.kind !== 'f' || row.return_type_oid !== '3802'
      || row.argument_type_oids !== '25 3802'
      || !/^CREATE OR REPLACE FUNCTION public\.analytics_normalize_output_v1\(/.test(row.definition)) {
    fail('NORMALIZER_FUNCTION_UNSUPPORTED');
  }
  return row;
}
function replacementDefinition(before, body) {
  // Change only prosrc. PostgreSQL's own deparser preserves the signature,
  // volatility, security, configuration and every original function attribute.
  const opening = /\nAS (\$[A-Za-z_][A-Za-z0-9_]*\$)/.exec(before.definition);
  if (!opening || body.includes(opening[1])) fail('NORMALIZER_DEFINITION_UNSUPPORTED');
  const start = opening.index + opening[0].length;
  const ending = `${opening[1]}\n`;
  const tail = before.definition.slice(start);
  const end = tail.lastIndexOf(opening[1]);
  if (end < 0 || tail.slice(0, end) !== before.body || !['\n', ';\n'].includes(tail.slice(end + opening[1].length))) {
    fail('NORMALIZER_DEFINITION_UNSUPPORTED');
  }
  return before.definition.slice(0, start) + body + ending;
}

export async function sync(db, { apply = false, expectedBeforeHash, saveBackup } = {}) {
  if (typeof apply !== 'boolean') fail('NORMALIZER_OPTIONS_INVALID');
  if (expectedBeforeHash !== undefined && (typeof expectedBeforeHash !== 'string' || !HEX.test(expectedBeforeHash))) fail('NORMALIZER_EXPECTED_HASH_INVALID');
  if (apply && (!HEX.test(expectedBeforeHash || '') || typeof saveBackup !== 'function')) fail('NORMALIZER_APPLY_GUARDS_REQUIRED');
  const body = generatedBody();
  const client = await db.connect();
  let transaction = false;
  try {
    await client.query(apply ? 'BEGIN' : 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    transaction = true;
    await client.query('SET LOCAL search_path = pg_catalog, public');
    // Apply requires a deployment freeze with no other DDL authors. This lock
    // serializes cooperating utility runs; it is not a universal catalogue CAS.
    if (apply) await client.query('SELECT pg_catalog.pg_advisory_xact_lock($1, $2)', [172019, 1]);
    const before = await inspect(client);
    const beforeHash = hash(before.definition);
    if (expectedBeforeHash && expectedBeforeHash !== beforeHash) fail('NORMALIZER_DEFINITION_DRIFT');
    const changed = before.body !== body;
    const response = { mode: apply ? changed ? 'APPLIED' : 'UNCHANGED' : 'DRY_RUN', changed,
      beforeFunctionHash: beforeHash, functionHash: beforeHash, rulesHash: SENTIMENT_RULESET_HASH };
    if (apply && changed) {
      const ddl = replacementDefinition(before, body);
      // A durable, exclusive, private backup is mandatory before the sole DDL.
      // It is a recovery artifact, never included in normal CLI output.
      await saveBackup({ signature: SIGNATURE, definition: before.definition, definitionHash: beforeHash,
        metadata: metadata(before), targetRulesHash: SENTIMENT_RULESET_HASH, createdAt: new Date().toISOString() });
      // Recheck after the awaited filesystem boundary to detect drift observed
      // so far. This cannot replace the required freeze against other DDL.
      const rechecked = await inspect(client);
      if (hash(rechecked.definition) !== beforeHash || JSON.stringify(metadata(rechecked)) !== JSON.stringify(metadata(before))) fail('NORMALIZER_DEFINITION_DRIFT');
      await client.query(ddl);
      const after = await inspect(client);
      if (after.body !== body || JSON.stringify(metadata(after)) !== JSON.stringify(metadata(before))) fail('NORMALIZER_POSTCHECK_FAILED');
      response.functionHash = hash(after.definition);
    }
    await client.query('COMMIT');
    transaction = false;
    return response;
  } catch (error) {
    if (transaction) {
      try { await client.query('ROLLBACK'); } catch { /* Preserve the original failure; the connection is released below. */ }
    }
    throw error;
  } finally { client.release(); }
}

export function parseArguments(args) {
  const options = { apply: false, runtimeRoot: '/opt/sarvam-voice-analytics' };
  const seen = new Set();
  for (let index = 0; index < args.length; index++) {
    const option = args[index];
    if (!['--dry-run', '--apply', '--expected-before-hash', '--backup-file', '--runtime-root'].includes(option) || seen.has(option)) fail('NORMALIZER_ARGUMENTS_INVALID');
    seen.add(option);
    if (option === '--dry-run') continue;
    if (option === '--apply') { options.apply = true; continue; }
    const value = args[++index];
    if (typeof value !== 'string' || !value || value.startsWith('--')) fail('NORMALIZER_ARGUMENTS_INVALID');
    options[option === '--expected-before-hash' ? 'expectedBeforeHash' : option === '--backup-file' ? 'backupFile' : 'runtimeRoot'] = value;
  }
  if (seen.has('--dry-run') && options.apply) fail('NORMALIZER_ARGUMENTS_INVALID');
  if (!path.isAbsolute(options.runtimeRoot) || path.resolve(options.runtimeRoot) === path.parse(options.runtimeRoot).root) fail('NORMALIZER_RUNTIME_ROOT_INVALID');
  if (options.expectedBeforeHash !== undefined && !HEX.test(options.expectedBeforeHash)) fail('NORMALIZER_EXPECTED_HASH_INVALID');
  if (options.backupFile !== undefined && !path.isAbsolute(options.backupFile)) fail('NORMALIZER_BACKUP_PATH_INVALID');
  if (options.apply && (!options.expectedBeforeHash || !options.backupFile)) fail('NORMALIZER_APPLY_GUARDS_REQUIRED');
  if (!options.apply && options.backupFile !== undefined) fail('NORMALIZER_ARGUMENTS_INVALID');
  return options;
}

export async function saveDurableBackup(filename, backup) {
  if (!path.isAbsolute(filename)) fail('NORMALIZER_BACKUP_PATH_INVALID');
  const file = await open(filename, 'wx', 0o600);
  try { await file.writeFile(JSON.stringify(backup, null, 2) + '\n', 'utf8'); await file.sync(); }
  finally { await file.close(); }
  const directory = await open(path.dirname(filename), 'r');
  try { await directory.sync(); } finally { await directory.close(); }
}

export async function runCli(args, { loadAdapter = async (root) => import(pathToFileURL(path.join(root, 'src/db/postgres.js')).href),
  write = (value) => console.log(value), backup = saveDurableBackup } = {}) {
  // Parse every flag before importing installed code or touching the database.
  const options = parseArguments(args);
  let db;
  try {
    const adapter = await loadAdapter(options.runtimeRoot);
    db = await adapter.getDb();
    const result = await sync(db, { apply: options.apply, expectedBeforeHash: options.expectedBeforeHash,
      saveBackup: options.apply ? (record) => backup(options.backupFile, record) : undefined });
    write(JSON.stringify(result));
    return result;
  } finally { if (db) await db.end(); }
}

const isMain = process.argv[1] && await realpath(process.argv[1]).then((filename) => filename === fileURLToPath(import.meta.url), () => false);
if (isMain) {
  try { await runCli(process.argv.slice(2)); }
  catch (error) {
    // Never print database messages, SQL, credentials, function text or stack.
    const code = typeof error?.code === 'string' && /^[A-Z0-9_]{1,80}$/.test(error.code) ? error.code : 'NORMALIZER_SYNC_FAILED';
    console.error(JSON.stringify({ status: 'FAILED', code }));
    process.exitCode = 1;
  }
}
