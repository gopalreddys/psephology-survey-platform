import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDb } from "./postgres.js";
import { buildNormalizationSqlFunction } from "../repositories/output-normalization.repository.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const historicalMigrations = [
  "024_amazon_quick_research_reporting.sql",
  "025_amazon_quick_geographic_heatmap.sql",
  "026_telangana_administrative_boundaries.sql",
  "027_psephology_decision_reporting.sql",
  "028_research_design_comparability.sql",
  "029_shared_comparison_gate.sql",
  "030_normalized_output_reporting.sql",
  "031_audited_research_methodology.sql",
  "032_sentiment_construct_reporting.sql"
];

// Metadata-only checks precede every migration. Once 034 appends columns,
// replaying 030/032 would try to remove them through CREATE OR REPLACE VIEW.
// Never interpret a partial upgrade as permission to replay older definitions.
const inspectSchema = `
WITH base(name) AS (VALUES ('campaign_iteration_links'),('calls'),('campaigns'),
  ('survey_studies'),('program_iterations'),('campaign_runs'),('voter_master'),
  ('call_executions'),('users')),
report(name) AS (VALUES ('analytics_research_enterprise_v2'),
  ('analytics_research_geographic_v2'),('analytics_iteration_movement_v2'),
  ('analytics_iteration_comparability_v1'),('analytics_research_quality_v1'),
  ('analytics_research_design_registry_v2')),
functions(signature) AS (VALUES ('public.analytics_normalize_output_v1(text,jsonb)'),
  ('public.analytics_select_output_v2(jsonb,text[])')),
columns AS (SELECT attname,atttypid,attnum FROM pg_attribute
  WHERE attrelid=to_regclass('public.analytics_research_enterprise_v2')
    AND attnum>0 AND NOT attisdropped)
SELECT
  ARRAY(SELECT name FROM base WHERE NOT EXISTS (SELECT 1 FROM pg_class
    WHERE oid=to_regclass('public.'||name) AND relkind IN ('r','p'))) AS missing_base_relations,
  ARRAY(SELECT name FROM report WHERE NOT EXISTS (SELECT 1 FROM pg_class
    WHERE oid=to_regclass('public.'||name) AND relkind='v')) AS missing_reporting_relations,
  ARRAY(SELECT signature FROM functions WHERE to_regprocedure(signature) IS NULL) AS missing_reporting_functions,
  EXISTS(SELECT 1 FROM columns WHERE attname='demographic_provenance') AS provenance_column,
  EXISTS(SELECT 1 FROM columns WHERE attname='direct_rating_status') AS rating_status_column,
  COALESCE((SELECT array_agg(attname::text ORDER BY attnum DESC) FROM
    (SELECT attname,attnum FROM columns ORDER BY attnum DESC LIMIT 2) final_columns)
    =ARRAY['direct_rating_status','demographic_provenance'],FALSE)
    AND NOT EXISTS(SELECT 1 FROM columns WHERE attname IN ('demographic_provenance','direct_rating_status')
      AND atttypid<>'text'::regtype) AS trailing_columns_valid,
  to_regprocedure('public.analytics_direct_rating_v1(jsonb)') IS NOT NULL AS direct_rating_function,
  to_regprocedure('public.analytics_direct_rating_status_v1(jsonb)') IS NOT NULL AS rating_status_function,
  to_regprocedure('public.analytics_construct_partition_reportable_v1(uuid,uuid,text)') IS NOT NULL AS partition_function,
  CASE WHEN EXISTS(SELECT 1 FROM pg_class
    WHERE oid=to_regclass('public.analytics_iteration_movement_v2') AND relkind='v')
    THEN position('reporting_partition_guards' IN
      pg_get_viewdef(to_regclass('public.analytics_iteration_movement_v2'),TRUE))>0
    ELSE FALSE END AS movement_guard
`;

function migrationPlan(state) {
  const arrays = ['missing_base_relations','missing_reporting_relations','missing_reporting_functions'];
  const flags = ['provenance_column','rating_status_column','trailing_columns_valid',
    'direct_rating_function','rating_status_function','partition_function','movement_guard'];
  if (!state || arrays.some((key) => !Array.isArray(state[key])) ||
      flags.some((key) => typeof state[key] !== 'boolean')) {
    throw new Error('Unable to verify the reporting migration schema; no migration applied');
  }
  if (state.missing_base_relations.length) {
    throw new Error(`Reporting migration base tables are missing: ${state.missing_base_relations.join(', ')}; no migration applied`);
  }
  const markers = flags.filter((key) => key !== 'trailing_columns_valid');
  if (markers.some((key) => state[key])) {
    if (flags.some((key) => !state[key]) || state.missing_reporting_relations.length ||
        state.missing_reporting_functions.length) {
      throw new Error('Partial or incompatible 034 reporting schema/prerequisites detected; operator review required, no migration applied');
    }
    return { mode: 'REAPPLY_034_ONLY', migrations: ['034_reporting_consistency.sql'] };
  }
  return { mode: 'INITIAL_BOOTSTRAP', migrations: [...historicalMigrations, '034_reporting_consistency.sql'] };
}

console.log("Checking Amazon Quick research reporting migration schema...");
const db = await getDb();
try {
  const state = await db.query(inspectSchema);
  const plan = migrationPlan(state.rows[0]);
  // Validate every required source file before the first mutating SQL query.
  const migrations = await Promise.all(plan.migrations.map(async (migration) => ({
    migration, sql: await readFile(path.resolve(here, "../../sql", migration), "utf8")
  })));
  console.log(`Reporting migration plan: ${plan.mode}`);
  for (const { migration, sql } of migrations) {
    if (migration.startsWith("030_")) await db.query(buildNormalizationSqlFunction());
    await db.query(sql);
    console.log(`Applied ${migration}`);
  }
  console.log("Amazon Quick research reporting migration completed.");
} finally {
  await db.end();
}
