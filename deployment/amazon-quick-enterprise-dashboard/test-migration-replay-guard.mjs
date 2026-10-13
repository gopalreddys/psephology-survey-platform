// Isolated installed-runner tests. No cloud, live database or source answers.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const runner = await readFile(path.join(here, 'migrate-amazon-quick-dashboard.js'), 'utf8');
const sql034 = await readFile(path.join(here, '034_reporting_consistency.sql'), 'utf8');
const complete = {
  missing_base_relations: [], missing_reporting_relations: [], missing_reporting_functions: [],
  provenance_column: true, rating_status_column: true, trailing_columns_valid: true,
  direct_rating_function: true, rating_status_function: true, partition_function: true, movement_guard: true
};
let runNumber = 0;
async function exercise(state, expectedError) {
  const root = await mkdtemp(path.join(tmpdir(), 'quick-migration-replay-'));
  const queries = [];
  let ended = false;
  try {
    await mkdir(path.join(root, 'src/db'), { recursive: true });
    await mkdir(path.join(root, 'src/repositories'), { recursive: true });
    await mkdir(path.join(root, 'sql'), { recursive: true });
    await writeFile(path.join(root, 'package.json'), '{"type":"module"}');
    await writeFile(path.join(root, 'src/db/migrate-amazon-quick-dashboard.js'), runner);
    await writeFile(path.join(root, 'src/db/postgres.js'),
      'export async function getDb(){ return globalThis.quickReplayGuardDb; }');
    await writeFile(path.join(root, 'src/repositories/output-normalization.repository.js'),
      'export function buildNormalizationSqlFunction(){ throw new Error("Historical normalizer replay is forbidden in this fixture"); }');
    // Only 034 is present. An upgraded database must not even read old files.
    await writeFile(path.join(root, 'sql/034_reporting_consistency.sql'), sql034);
    globalThis.quickReplayGuardDb = {
      async query(sql) { queries.push(sql); return { rows: queries.length === 1 ? [state] : [] }; },
      async end() { ended = true; }
    };
    const invocation = import(`${pathToFileURL(path.join(root, 'src/db/migrate-amazon-quick-dashboard.js')).href}?case=${runNumber++}`);
    if (expectedError) await assert.rejects(invocation, expectedError);
    else await invocation;
    assert.equal(ended, true, 'The runner closes its adapter on success and rejected schema checks');
    assert.match(queries[0], /^\s*WITH base\(name\)/);
    assert.doesNotMatch(queries[0], /\b(?:CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|TRUNCATE)\s/i,
      'Schema detection must not mutate the database');
    assert.equal(queries.length, expectedError ? 1 : 2,
      'Rejected metadata causes no migration writes; accepted upgrade applies only 034');
    if (!expectedError) assert.equal(queries[1], sql034);
  } finally {
    delete globalThis.quickReplayGuardDb;
    await rm(root, { recursive: true, force: true });
  }
}

await exercise(complete);
await exercise(complete); // Separate repeated invocation remains 034-only.
for (const flag of ['provenance_column','rating_status_column','trailing_columns_valid',
  'direct_rating_function','rating_status_function','partition_function','movement_guard']) {
  await exercise({ ...complete, [flag]: false }, /Partial or incompatible 034/);
}
await exercise({ ...complete, missing_reporting_relations: ['analytics_iteration_comparability_v1'] }, /Partial or incompatible 034/);
await exercise({ ...complete, missing_reporting_functions: ['public.analytics_select_output_v2(jsonb,text[])'] }, /Partial or incompatible 034/);
await exercise({ ...complete, missing_base_relations: ['calls'] }, /base tables are missing/);
await exercise({ ...complete, rating_status_column: undefined }, /Unable to verify/);
await exercise(undefined, /Unable to verify/);
const initial = { ...complete, provenance_column: false, rating_status_column: false,
  trailing_columns_valid: false, direct_rating_function: false, rating_status_function: false,
  partition_function: false, movement_guard: false, missing_base_relations: ['campaigns'] };
await exercise(initial, /base tables are missing/);

// Execute the real catalog query as well, against isolated PostgreSQL-compatible
// metadata. This establishes SQL syntax and marker detection beyond the mocks.
const { PGlite } = await import(process.env.PGLITE_MODULE_PATH
  ? pathToFileURL(path.resolve(process.env.PGLITE_MODULE_PATH)).href : '@electric-sql/pglite');
const isolated = new PGlite();
try {
  const inspectionSql = /const inspectSchema = `([\s\S]*?)`;/u.exec(runner)?.[1];
  assert.ok(inspectionSql);
  const empty = (await isolated.query(inspectionSql)).rows[0];
  assert.equal(empty.missing_base_relations.length, 9);
  assert.equal(empty.movement_guard, false,
    'An absent movement relation is safely inspected without resolving a missing regclass constant');
  for (const name of ['campaign_iteration_links','calls','campaigns','survey_studies',
    'program_iterations','campaign_runs','voter_master','call_executions','users']) {
    await isolated.exec(`CREATE TABLE ${name} (id integer)`);
  }
  const bootstrap = (await isolated.query(inspectionSql)).rows[0];
  assert.deepEqual(bootstrap.missing_base_relations, []);
  assert.equal(bootstrap.provenance_column, false);
  assert.equal(bootstrap.rating_status_column, false);
  await isolated.exec(`
    CREATE VIEW analytics_research_enterprise_v2 AS SELECT 1 AS id,
      'CURRENT_MASTER_DATA'::text AS demographic_provenance, 'MISSING'::text AS direct_rating_status;
    CREATE VIEW analytics_research_geographic_v2 AS SELECT 1 AS id;
    CREATE VIEW analytics_iteration_movement_v2 AS WITH reporting_partition_guards AS (SELECT 1 AS id)
      SELECT * FROM reporting_partition_guards;
    CREATE VIEW analytics_iteration_comparability_v1 AS SELECT 1 AS id;
    CREATE VIEW analytics_research_quality_v1 AS SELECT 1 AS id;
    CREATE VIEW analytics_research_design_registry_v2 AS SELECT 1 AS id;
    CREATE FUNCTION analytics_normalize_output_v1(text,jsonb) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
    CREATE FUNCTION analytics_select_output_v2(jsonb,text[]) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
    CREATE FUNCTION analytics_direct_rating_v1(jsonb) RETURNS numeric LANGUAGE sql AS $$ SELECT NULL::numeric $$;
    CREATE FUNCTION analytics_direct_rating_status_v1(jsonb) RETURNS text LANGUAGE sql AS $$ SELECT 'MISSING'::text $$;
    CREATE FUNCTION analytics_construct_partition_reportable_v1(uuid,uuid,text) RETURNS boolean LANGUAGE sql AS $$ SELECT FALSE $$;
  `);
  assert.deepEqual((await isolated.query(inspectionSql)).rows[0], complete,
    'Actual catalog metadata recognizes the complete upgraded schema');
  await isolated.exec('DROP FUNCTION analytics_select_output_v2(jsonb,text[])');
  assert.deepEqual((await isolated.query(inspectionSql)).rows[0].missing_reporting_functions,
    ['public.analytics_select_output_v2(jsonb,text[])']);
} finally {
  await isolated.close();
}
console.log('Migration replay guard passed: complete 034 reapplication, partial/prerequisite failures before mutation, read-only checks and adapter cleanup.');
