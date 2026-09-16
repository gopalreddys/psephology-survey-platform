import { randomUUID } from "node:crypto";
import { getDb } from "../db/postgres.js";
import { assertIterationAccess } from "./iteration-access.repository.js";
import { validateQuickAddInput } from "./demo-voter-quick-add.validation.js";

const DEMO_SOURCE = "PSEPHOLOGY_DEMO_CONTACTS";

function fail(message, statusCode, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

async function runForActor(runId, actor) {
  const pool = await getDb();
  const result = await pool.query(
    "SELECT id, iteration_id FROM campaign_runs WHERE id = $1",
    [runId]
  );
  if (!result.rowCount) throw fail("Run not found", 404, "RUN_NOT_FOUND");
  await assertIterationAccess(result.rows[0].iteration_id, actor);
  return result.rows[0];
}

async function assertUnstartedRun(db, runId) {
  const result = await db.query(`
    SELECT run.id, run.iteration_id, run.status, run.run_number,
      iteration.target_sample_size,
      COALESCE(link.status, iteration.status) AS iteration_status,
      campaign.status AS campaign_status
    FROM campaign_runs run
    JOIN program_iterations iteration ON iteration.id = run.iteration_id
    JOIN campaign_iteration_links link ON link.iteration_id = iteration.id
    JOIN campaigns campaign ON campaign.id = link.campaign_id
    WHERE run.id = $1
    FOR UPDATE OF run, iteration
  `, [runId]);

  const run = result.rows[0];
  if (!run) throw fail("Run not found", 404, "RUN_NOT_FOUND");
  if (Number(run.run_number) !== 1 || String(run.status).toUpperCase() !== "READY") {
    throw fail("Demo voters can be added only to a READY Run 1", 409, "RUN_NOT_READY");
  }
  if (["COMPLETED", "LOCKED"].includes(String(run.iteration_status).toUpperCase()) ||
      ["COMPLETED", "ARCHIVED"].includes(String(run.campaign_status).toUpperCase())) {
    throw fail("Campaign or iteration is closed", 409, "SCOPE_CLOSED");
  }

  const history = await db.query(`
    SELECT
      EXISTS(SELECT 1 FROM call_executions WHERE run_id = $1) AS has_executions,
      EXISTS(SELECT 1 FROM campaign_run_contacts
        WHERE run_id = $1 AND (attempt_count > 0 OR attempt_status <> 'PENDING'
          OR final_status <> 'PENDING')) AS has_attempted_contacts,
      EXISTS(SELECT 1 FROM campaign_run_cycles
        WHERE run_id = $1 AND status <> 'READY') AS has_started_cycle,
      EXISTS(SELECT 1 FROM campaign_runs
        WHERE iteration_id = $2 AND run_number > 1) AS has_later_run
  `, [runId, run.iteration_id]);

  if (Object.values(history.rows[0]).some(Boolean)) {
    throw fail("This Run has execution history or a later Run; its cohort cannot be expanded", 409, "RUN_ALREADY_STARTED");
  }
  return run;
}

async function runGeographies(db, runId) {
  const result = await db.query(`
    SELECT DISTINCT geo.id, geo.name, geo.geo_type
    FROM campaign_run_contacts contact
    JOIN voter_master voter ON voter.id = contact.voter_id
    JOIN geo_units geo ON geo.id = voter.geo_unit_id
    WHERE contact.run_id = $1
      AND contact.selection_status = 'SELECTED'
      AND geo.is_active = TRUE
    ORDER BY geo.name, geo.id
  `, [runId]);
  return result.rows;
}

export async function listQuickAddGeographies(runId, actor) {
  await runForActor(runId, actor);
  const pool = await getDb();
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await assertUnstartedRun(db, runId);
    const geographies = await runGeographies(db, runId);
    await db.query("COMMIT");
    return geographies;
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}

export async function addQuickDemoVoterToRun(runId, actor, input) {
  const voter = validateQuickAddInput(input);
  await runForActor(runId, actor);
  const pool = await getDb();
  const db = await pool.connect();

  try {
    await db.query("BEGIN");
    const run = await assertUnstartedRun(db, runId);
    const geographies = await runGeographies(db, runId);
    const geography = geographies.find((item) => item.id === voter.geoUnitId);
    if (!geography) {
      throw fail("Choose a geography already in this Run's approved allocation", 409, "GEOGRAPHY_OUTSIDE_RUN");
    }

    // A number already present in the master may belong to a real voter. Never
    // silently turn that existing record into a demo contact.
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [voter.phoneNumber]);
    const duplicate = await db.query(`
      SELECT id FROM voter_master
      WHERE RIGHT(regexp_replace(COALESCE(phone_number, ''), '[^0-9]', '', 'g'), 10) = $1
      LIMIT 1
    `, [voter.phoneNumber]);
    if (duplicate.rowCount) {
      throw fail("This phone number is already registered; no demo approval was changed", 409, "PHONE_EXISTS");
    }

    const columns = ["id", "full_name", "phone_number", "epic_number", "geo_unit_id",
      "source_name", "preferred_language", "age", "gender", "qualification",
      "is_demo_contact", "is_active", "contact_status", "metadata",
      "assembly_constituency_no", "assembly_constituency_name", "mandal_name_source"];
    const schema = await db.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'voter_master'
        AND is_nullable = 'NO' AND column_default IS NULL
        AND is_generated = 'NEVER' AND identity_generation IS NULL
    `);
    const unsupported = schema.rows.map((row) => row.column_name)
      .filter((column) => !columns.includes(column));
    if (unsupported.length) {
      throw fail("The voter master has required fields not supported by quick add: " + unsupported.join(", "),
        409, "VOTER_SCHEMA_INCOMPATIBLE");
    }

    const id = randomUUID();
    const internalDemoId = `DEMO${id.replace(/-/g, "").slice(0, 12).toUpperCase()}`;
    const template = await db.query(`
      SELECT assembly_constituency_no, assembly_constituency_name, mandal_name_source
      FROM voter_master
      WHERE geo_unit_id = $1 AND id IN (
        SELECT voter_id FROM campaign_run_contacts WHERE run_id = $2
      )
      ORDER BY id LIMIT 1
    `, [voter.geoUnitId, runId]);
    const mapped = template.rows[0] || {};

    await db.query(`
      INSERT INTO voter_master (
        id, full_name, phone_number, geo_unit_id, source_name,
        preferred_language, age, gender, qualification, is_demo_contact,
        is_active, contact_status, assembly_constituency_no,
        assembly_constituency_name, mandal_name_source, metadata
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, NULL, TRUE, TRUE, 'ACTIVE',
        $9, $10, $11, $12::jsonb
      )
    `, [id, voter.fullName, voter.phoneNumber, voter.geoUnitId,
      DEMO_SOURCE, voter.preferredLanguage, voter.age, voter.gender,
      mapped.assembly_constituency_no || null,
      mapped.assembly_constituency_name || null,
      mapped.mandal_name_source || geography.name,
      JSON.stringify({ origin: "ADMIN_QUICK_ADD", identifierKind: "INTERNAL_DEMO",
        consentConfirmedAt: new Date().toISOString() })]);

    const identifier = await db.query(`
      INSERT INTO voter_identifiers (
        voter_id, identifier_type, identifier_value, issuing_authority,
        status, is_primary, source_name, metadata
      ) VALUES (
        $1, 'INTERNAL_DEMO', $2, 'Psephology platform',
        'ACTIVE', TRUE, $3, $4::jsonb
      )
      RETURNING id
    `, [id, internalDemoId, DEMO_SOURCE,
      JSON.stringify({ origin: "ADMIN_QUICK_ADD" })]);

    await db.query(`
      INSERT INTO voter_electorate_registrations (
        voter_id, electorate_type, target_type, geo_unit_id,
        roll_identifier_id, eligibility_basis, eligibility_status,
        source_name, verified_at, metadata
      ) VALUES (
        $1, 'DEMO', 'DEMO', $2, $3, 'CONSENTED_DEMO', 'VERIFIED',
        $4, now(), $5::jsonb
      )
    `, [id, voter.geoUnitId, identifier.rows[0].id, DEMO_SOURCE,
      JSON.stringify({ consentConfirmed: true, approvedBy: actor.id })]);

    await db.query(`
      INSERT INTO voter_demo_contact_audit (voter_id, previous_value, new_value, reason)
      VALUES ($1, FALSE, TRUE, $2)
    `, [id, `Consented Admin quick add to Run 1 by ${actor.id}`]);

    const contact = await db.query(`
      INSERT INTO campaign_run_contacts (
        run_id, voter_id, selection_status, attempt_status, final_status, retry_eligible
      ) VALUES ($1, $2, 'SELECTED', 'PENDING', 'PENDING', FALSE)
      RETURNING id
    `, [runId, id]);

    const count = await db.query(
      "SELECT COUNT(*)::int AS total FROM campaign_run_contacts WHERE run_id = $1 AND selection_status = 'SELECTED'",
      [runId]
    );
    const total = Number(count.rows[0].total);
    await db.query(
      "UPDATE campaign_runs SET target_contacts = $2, updated_at = now() WHERE id = $1",
      [runId, total]
    );
    await db.query(
      "UPDATE program_iterations SET target_sample_size = GREATEST(COALESCE(target_sample_size, 0), $2), updated_at = now() WHERE id = $1",
      [run.iteration_id, total]
    );
    await db.query("COMMIT");

    return { voterId: id, runContactId: contact.rows[0].id,
      fullName: voter.fullName, phoneEnding: voter.phoneNumber.slice(-4),
      internalDemoId, selectedContacts: total };
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}
