import { getDb } from "./postgres.js";

const APPLY = process.argv.includes("--apply");

const OPERATIONAL_TABLES = [
  "survey_studies",
  "study_geo_scope",
  "program_iterations",
  "campaigns",
  "campaign_geo_scope",
  "campaign_mandal_assignments",
  "campaign_work_allocations",
  "campaign_iteration_links",
  "campaign_runs",
  "campaign_run_cycles",
  "campaign_run_contacts",
  "call_executions",
  "calls",
  "iteration_agent_configs",
  "survey_responses"
];

const PROTECTED_TABLES = [
  "users",
  "roles",
  "geo_units",
  "voter_master",
  "questionnaires",
  "agent_profiles"
];

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

async function readCounts(db, tables) {
  const counts = {};

  for (const table of tables) {
    const result = await db.query(
      `SELECT COUNT(*)::bigint AS rows FROM public.${quoteIdentifier(table)}`
    );
    counts[table] = Number(result.rows[0].rows);
  }

  return counts;
}

function rowsForConsole(counts) {
  return Object.entries(counts).map(([table_name, rows]) => ({
    table_name,
    rows
  }));
}

function backupSchemaName() {
  const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  return `demo_operations_backup_${timestamp}`;
}

async function createBackup(db, schemaName, counts) {
  const schema = quoteIdentifier(schemaName);
  await db.query(`CREATE SCHEMA ${schema}`);

  for (const table of OPERATIONAL_TABLES) {
    await db.query(
      `CREATE TABLE ${schema}.${quoteIdentifier(table)} AS TABLE public.${quoteIdentifier(table)}`
    );
  }

  await db.query(`
    CREATE TABLE ${schema}.reset_manifest (
      table_name text PRIMARY KEY,
      pre_reset_rows bigint NOT NULL,
      reset_at timestamptz NOT NULL DEFAULT NOW()
    )
  `);

  for (const [table, rows] of Object.entries(counts)) {
    await db.query(
      `INSERT INTO ${schema}.reset_manifest (table_name, pre_reset_rows) VALUES ($1, $2)`,
      [table, rows]
    );
  }
}

async function deleteOperationalChain(db) {
  // Remove only call evidence linked to the Programs/Runs being reset. Any
  // unrelated legacy call record remains available.
  await db.query(`
    DELETE FROM call_executions execution
    WHERE execution.run_id IN (SELECT id FROM campaign_runs)
       OR execution.run_contact_id IN (SELECT id FROM campaign_run_contacts)
       OR execution.attempt_cycle_id IN (SELECT id FROM campaign_run_cycles)
  `);

  await db.query(`
    DELETE FROM survey_responses response
    WHERE response.run_id IN (SELECT id FROM campaign_runs)
       OR response.iteration_id IN (SELECT id FROM program_iterations)
       OR response.study_id IN (SELECT id FROM survey_studies)
  `);

  await db.query(`
    DELETE FROM calls call_record
    WHERE call_record.run_id IN (SELECT id FROM campaign_runs)
       OR call_record.iteration_id IN (SELECT id FROM program_iterations)
       OR call_record.study_id IN (SELECT id FROM survey_studies)
       OR call_record.campaign_id IN (SELECT id FROM campaigns)
  `);

  await db.query("DELETE FROM campaign_run_contacts");
  await db.query("DELETE FROM campaign_run_cycles");
  await db.query("DELETE FROM campaign_runs");
  await db.query("DELETE FROM campaign_work_allocations");
  await db.query("DELETE FROM campaign_iteration_links");
  await db.query("DELETE FROM iteration_agent_configs");
  await db.query("DELETE FROM campaign_geo_scope");
  await db.query("DELETE FROM campaign_mandal_assignments");
  await db.query("DELETE FROM campaigns");
  await db.query("DELETE FROM program_iterations");
  await db.query("DELETE FROM study_geo_scope");
  await db.query("DELETE FROM survey_studies");
}

function assertProtectedCounts(before, after) {
  for (const table of PROTECTED_TABLES) {
    if (before[table] !== after[table]) {
      throw new Error(
        `Protected table ${table} changed from ${before[table]} to ${after[table]}`
      );
    }
  }
}

function assertOperationalReset(counts) {
  // Calls and call executions can contain legitimate legacy records that were
  // never linked to a Program/Campaign. Only linked rows are deleted above.
  const mayContainUnlinkedHistory = new Set(["calls", "call_executions"]);
  const mustBeEmpty = OPERATIONAL_TABLES.filter(
    (table) => !mayContainUnlinkedHistory.has(table)
  );
  const remaining = mustBeEmpty.filter((table) => counts[table] !== 0);

  if (remaining.length > 0) {
    throw new Error(`Operational reset incomplete: ${remaining.join(", ")}`);
  }
}

async function reset() {
  const db = await getDb();
  const operationalBefore = await readCounts(db, OPERATIONAL_TABLES);
  const protectedBefore = await readCounts(db, PROTECTED_TABLES);

  console.log("Operational records selected for reset:");
  console.table(rowsForConsole(operationalBefore));
  console.log("Protected master records:");
  console.table(rowsForConsole(protectedBefore));

  if (!APPLY) {
    console.log("Dry run passed. Re-run with --apply while the API service is stopped.");
    return;
  }

  const schemaName = backupSchemaName();

  await db.query("BEGIN");
  try {
    await createBackup(db, schemaName, operationalBefore);
    console.log(`Pre-reset backup schema: ${schemaName}`);

    await deleteOperationalChain(db);

    const operationalAfter = await readCounts(db, OPERATIONAL_TABLES);
    const protectedAfter = await readCounts(db, PROTECTED_TABLES);
    assertOperationalReset(operationalAfter);
    assertProtectedCounts(protectedBefore, protectedAfter);

    await db.query("COMMIT");
    console.log("Operational reset committed.");
    console.log("Remaining operational records:");
    console.table(rowsForConsole(operationalAfter));
    console.log("Protected master records verified unchanged:");
    console.table(rowsForConsole(protectedAfter));
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  }
}

reset()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Operational reset failed; transaction rolled back:", error);
    process.exit(1);
  });
