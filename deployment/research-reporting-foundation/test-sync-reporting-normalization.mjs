// Isolated function-body update tests: no AWS, RDS, credentials or survey rows.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, stat, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { sync, parseArguments, runCli, saveDurableBackup } from './sync-reporting-normalization.mjs';
import { buildNormalizationSqlFunction, normalizeOutputValue, SENTIMENT_RULESET_HASH } from '../output-variable-standardization/output-normalization.repository.js';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const body = /AS \$normalize\$([\s\S]*)\$normalize\$;/.exec(buildNormalizationSqlFunction())[1];
const oldBody = "\nBEGIN\n RETURN '{}'::jsonb;\nEND;\n";
const definition = (source) => `CREATE OR REPLACE FUNCTION public.analytics_normalize_output_v1(output_key text, raw_value jsonb)\n RETURNS jsonb\n LANGUAGE plpgsql\n IMMUTABLE STRICT SECURITY DEFINER\n SET search_path TO pg_catalog, public\nAS $function$${source}$function$\n`;
const fixture = () => ({ oid: '172019', definition: definition(oldBody), body: oldBody,
  owner_oid: '10', acl: '{owner=X/owner,reader=X/owner}', security_definer: true, leakproof: false,
  volatility: 'i', parallel: 'u', strict: true, returns_set: false, return_type_oid: '3802',
  argument_type_oids: '25 3802', all_argument_type_oids: null, argument_modes: null,
  argument_names: '{output_key,raw_value}', kind: 'f', language_oid: '13563',
  configuration: '{"search_path=pg_catalog, public"}', default_argument_count: 0,
  argument_defaults: null, binary_path: null, cost: 100, rows: 0, support_function_oid: '0', language_name: 'plpgsql' });
function fake(changes = {}) {
  let row = { ...fixture(), ...changes.row }, saved, inspections = 0;
  const state = { queries: [], released: 0, ended: 0, backupFinished: false, ddl: 0 };
  const client = { async query(sql, values) {
    state.queries.push({ sql, values });
    if (sql.startsWith('BEGIN')) { saved = structuredClone(row); return { rows: [] }; }
    if (sql === 'COMMIT' && changes.commitFailure) throw new Error('SENSITIVE COMMIT FAILURE');
    if (sql === 'ROLLBACK') { row = saved; return { rows: [] }; }
    if (sql.includes('FROM pg_catalog.pg_proc p')) {
      inspections++;
      if (changes.inspectFailure === inspections) throw new Error('SENSITIVE DATABASE ERROR');
      if (changes.driftAt === inspections) row.definition += '-- concurrent writer\n';
      return { rows: changes.absent ? [] : [structuredClone(row)] };
    }
    if (sql.startsWith('CREATE OR REPLACE FUNCTION')) {
      assert.equal(state.backupFinished, true, 'The awaited backup must finish before DDL');
      state.ddl++;
      if (changes.ddlFailure) throw new Error('SENSITIVE SQL ERROR');
      const replacement = /\nAS \$function\$([\s\S]*)\$function\$\n$/.exec(sql)?.[1];
      assert.equal(replacement, body);
      row.body = changes.wrongBody ? 'wrong' : replacement;
      row.definition = sql;
      if (changes.alterOwner) row.owner_oid = '999';
      if (changes.alterAcl) row.acl = null;
      if (changes.alterSecurity) row.security_definer = false;
      if (changes.alterVolatility) row.volatility = 'v';
      return { rows: [] };
    }
    return { rows: [] };
  }, release() { state.released++; } };
  return { state, row: () => row, connect: async () => client, end: async () => { state.ended++; } };
}
let db = fake();
const dry = await sync(db, { saveBackup() { throw new Error('Dry run must not touch backups'); } });
assert.equal(dry.mode, 'DRY_RUN');
assert.equal(dry.changed, true);
assert.equal(dry.beforeFunctionHash, hash(fixture().definition));
assert.equal(dry.functionHash, dry.beforeFunctionHash);
assert.equal(dry.rulesHash, SENTIMENT_RULESET_HASH);
assert.ok(db.state.queries[0].sql.includes('READ ONLY'));
assert.equal(db.state.ddl, 0);
assert.equal(db.state.released, 1);
assert.deepEqual(Object.keys(dry).sort(), ['mode', 'changed', 'beforeFunctionHash', 'functionHash', 'rulesHash'].sort());
assert.ok(!JSON.stringify(dry).includes(oldBody));
for (const options of [{ apply: true }, { apply: true, expectedBeforeHash: 'a'.repeat(64) },
  { apply: 'yes' }, { expectedBeforeHash: 'invalid' }, { expectedBeforeHash: { toString: () => 'a'.repeat(64) } }]) {
  const guarded = fake();
  await assert.rejects(sync(guarded, options));
  assert.equal(guarded.state.queries.length, 0);
}
const expectedBeforeHash = dry.beforeFunctionHash;
db = fake();
const before = structuredClone(db.row());
let savedBackup;
const applied = await sync(db, { apply: true, expectedBeforeHash, saveBackup: async (record) => {
  savedBackup = record;
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(db.state.ddl, 0);
  db.state.backupFinished = true;
} });
assert.equal(applied.mode, 'APPLIED');
assert.equal(db.state.ddl, 1);
assert.equal(db.row().body, body);
assert.equal(savedBackup.definition, before.definition);
assert.equal(savedBackup.definitionHash, expectedBeforeHash);
assert.equal(savedBackup.targetRulesHash, SENTIMENT_RULESET_HASH);
assert.equal(savedBackup.rulesHash, undefined, 'A backup must not mislabel the target rules as its old evaluation rules');
for (const [key, value] of Object.entries(before)) if (!['body', 'definition'].includes(key)) assert.deepEqual(db.row()[key], value);
assert.ok(db.state.queries.some(({ sql }) => sql === 'SET LOCAL search_path = pg_catalog, public'));
assert.ok(db.state.queries.some(({ sql }) => sql.includes('pg_advisory_xact_lock')));
assert.equal(db.state.queries.at(-1).sql, 'COMMIT');
assert.equal(db.state.released, 1);
const unchanged = await sync(db, { apply: true, expectedBeforeHash: applied.functionHash,
  saveBackup() { throw new Error('No DDL requires no new backup'); } });
assert.equal(unchanged.mode, 'UNCHANGED');
assert.equal(unchanged.changed, false);
assert.equal(db.state.ddl, 1, 'Idempotent apply does not repeat DDL');
for (const changes of [{ driftAt: 1 }, { driftAt: 2 }, { ddlFailure: true }, { wrongBody: true },
  { alterOwner: true }, { alterAcl: true }, { alterSecurity: true }, { alterVolatility: true },
  { inspectFailure: 3 }, { commitFailure: true }, { absent: true }, { row: { language_name: 'sql' } }, { row: { kind: 'p' } }]) {
  const failure = fake(changes);
  const original = structuredClone(failure.row());
  await assert.rejects(sync(failure, { apply: true, expectedBeforeHash,
    saveBackup: async () => { failure.state.backupFinished = true; } }));
  assert.equal(failure.state.queries.at(-1).sql, 'ROLLBACK');
  assert.deepEqual(failure.row(), original, 'A failed apply leaves function definition and metadata unchanged');
  assert.equal(failure.state.released, 1);
}
const failedBackup = fake();
await assert.rejects(sync(failedBackup, { apply: true, expectedBeforeHash, saveBackup: async () => { throw new Error('Backup failed'); } }), /Backup failed/);
assert.equal(failedBackup.state.ddl, 0);
assert.equal(failedBackup.state.queries.at(-1).sql, 'ROLLBACK');
for (const args of [['--unknown'], ['--apply'], ['--dry-run', '--apply'], ['--runtime-root', '/'],
  ['--runtime-root', 'relative'], ['--expected-before-hash', 'no'], ['--backup-file', '/tmp/not-opened'],
  ['--apply', '--expected-before-hash', expectedBeforeHash, '--backup-file', 'relative'], ['--dry-run', '--dry-run']]) {
  let imports = 0;
  await assert.rejects(runCli(args, { loadAdapter: async () => { imports++; throw new Error('No adapter may be imported'); } }));
  assert.equal(imports, 0, 'Arguments are validated before installed code import or database access');
}
assert.equal(parseArguments([]).apply, false);
assert.equal(parseArguments(['--dry-run']).apply, false);
const cliDb = fake();
const writes = [];
await runCli([], { loadAdapter: async () => ({ getDb: async () => cliDb }), write: (value) => writes.push(value), backup() { throw new Error('Dry run backup forbidden'); } });
assert.equal(cliDb.state.ended, 1);
assert.equal(cliDb.state.ddl, 0);
assert.equal(JSON.parse(writes[0]).mode, 'DRY_RUN');
const brokenCliDb = fake({ inspectFailure: 1 });
await assert.rejects(runCli([], { loadAdapter: async () => ({ getDb: async () => brokenCliDb }), write() { throw new Error('Failure cannot print a success'); } }));
assert.equal(brokenCliDb.state.ended, 1, 'The pool closes on a rejected database inspection');

const directory = await mkdtemp(path.join(tmpdir(), 'reporting-normalizer-backup-'));
try {
  const filename = path.join(directory, 'before.json');
  await saveDurableBackup(filename, savedBackup);
  assert.equal((await stat(filename)).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(await readFile(filename, 'utf8')), savedBackup);
  await assert.rejects(saveDurableBackup(filename, { overwritten: true }), (error) => error.code === 'EEXIST');
  assert.deepEqual(JSON.parse(await readFile(filename, 'utf8')), savedBackup);
  await assert.rejects(saveDurableBackup('relative.json', savedBackup));

  // The deployed src/db location imports the installed normalization module;
  // merely importing it does not import the installed database adapter.
  await mkdir(path.join(directory, 'src/db'), { recursive: true });
  await mkdir(path.join(directory, 'src/repositories'), { recursive: true });
  await writeFile(path.join(directory, 'package.json'), '{"type":"module"}');
  await writeFile(path.join(directory, 'src/db/sync-reporting-normalization.mjs'), await readFile(new URL('./sync-reporting-normalization.mjs', import.meta.url)));
  await writeFile(path.join(directory, 'src/db/postgres.js'), 'throw new Error("IMPORTING INSTALLED DATABASE ADAPTER IS FORBIDDEN IN THIS TEST");');
  await writeFile(path.join(directory, 'src/repositories/output-normalization.repository.js'), `export const SENTIMENT_RULESET_HASH = ${JSON.stringify(SENTIMENT_RULESET_HASH)}; export const buildNormalizationSqlFunction = () => ${JSON.stringify(buildNormalizationSqlFunction())};`);
  const deployed = await import(pathToFileURL(path.join(directory, 'src/db/sync-reporting-normalization.mjs')).href);
  assert.equal((await deployed.sync(fake())).mode, 'DRY_RUN');
  const rejectedCli = spawnSync(process.execPath, [path.join(directory, 'src/db/sync-reporting-normalization.mjs'), '--unknown'], { encoding: 'utf8' });
  assert.equal(rejectedCli.status, 1);
  assert.equal(rejectedCli.stdout, '');
  assert.deepEqual(JSON.parse(rejectedCli.stderr), { status: 'FAILED', code: 'NORMALIZER_ARGUMENTS_INVALID' });
  assert.ok(!rejectedCli.stderr.includes('IMPORTING INSTALLED DATABASE ADAPTER'));

  const { PGlite } = await import(process.env.PGLITE_MODULE_PATH
    ? pathToFileURL(process.env.PGLITE_MODULE_PATH).href : '@electric-sql/pglite');
  const isolated = new PGlite();
  const adapter = { connect: async () => ({ query: isolated.query.bind(isolated), release() {} }) };
  try {
    await isolated.exec(`CREATE ROLE reporting_reader;
      CREATE FUNCTION public.analytics_normalize_output_v1(output_key text, raw_value jsonb) RETURNS jsonb
        LANGUAGE plpgsql IMMUTABLE STRICT SECURITY DEFINER SET search_path = pg_catalog, public
        AS $before$${oldBody}$before$;
      REVOKE ALL ON FUNCTION public.analytics_normalize_output_v1(text,jsonb) FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION public.analytics_normalize_output_v1(text,jsonb) TO reporting_reader;`);
    const inspection = await sync(adapter);
    assert.equal(inspection.mode, 'DRY_RUN');
    await assert.rejects(sync(adapter, { apply: true, expectedBeforeHash: inspection.functionHash,
      saveBackup: async () => { await isolated.exec('GRANT EXECUTE ON FUNCTION public.analytics_normalize_output_v1(text,jsonb) TO PUBLIC'); } }),
    (error) => error.code === 'NORMALIZER_DEFINITION_DRIFT', 'ACL drift at the filesystem boundary must abort before function replacement');
    assert.equal((await sync(adapter)).functionHash, inspection.functionHash);
    const accessAfterRollback = (await isolated.query("SELECT proacl::text AS acl FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure('public.analytics_normalize_output_v1(text,jsonb)')")).rows[0].acl;
    assert.ok(!/[{,]=X\//.test(accessAfterRollback), 'An aborted transaction restores the original ACL rather than retaining PUBLIC execute');
    let backup;
    const result = await sync(adapter, { apply: true, expectedBeforeHash: inspection.functionHash,
      saveBackup: async (record) => { backup = record; } });
    assert.equal(result.mode, 'APPLIED');
    assert.equal(backup.metadata.security_definer, true);
    assert.equal(backup.metadata.strict, true);
    assert.ok(backup.metadata.acl.includes('reporting_reader'));
    assert.equal((await sync(adapter, { apply: true, expectedBeforeHash: result.functionHash,
      saveBackup: async () => { throw new Error('Idempotent PostgreSQL apply cannot touch backup'); } })).mode, 'UNCHANGED');
    for (const key of ['leader_assessment', 'leader_sentiment', 'development_priority', 'desired_change']) {
      for (const value of ['good', 'bad', 'mixed', 'jobs', 'water', "can't say", 'refused', 'unrecognized wording']) {
        const actual = (await isolated.query('SELECT public.analytics_normalize_output_v1($1,$2::jsonb) AS value', [key, JSON.stringify(value)])).rows[0].value;
        assert.deepEqual(actual, normalizeOutputValue(key, value));
      }
    }
    const restored = await sync(adapter);
    assert.equal(restored.changed, false);
    assert.equal(restored.functionHash, result.functionHash);
  } finally { await isolated.close(); }
} finally { await rm(directory, { recursive: true, force: true }); }
console.log('Guarded reporting normalizer dry-run, exact drift, durable backup, metadata/ACL preservation, rollback, installed CLI and PostgreSQL parity tests passed.');
