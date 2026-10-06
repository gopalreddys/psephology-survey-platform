import { randomUUID } from "node:crypto";
import { getDb } from "../db/postgres.js";
import { validateQuickAddInput } from "./demo-voter-quick-add.validation.js";

const DEMO_SOURCE = "PSEPHOLOGY_DEMO_CONTACTS";

function fail(message, statusCode, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

async function voterMasterGeographies(db) {
  const result = await db.query(`
    SELECT geo.id, geo.name, geo.geo_type, COUNT(voter.id)::int AS voter_count
    FROM voter_master voter
    JOIN geo_units geo ON geo.id = voter.geo_unit_id
    WHERE voter.is_active = TRUE
      AND geo.is_active = TRUE
    GROUP BY geo.id, geo.name, geo.geo_type
    ORDER BY geo.name, geo.geo_type, geo.id
  `);
  return result.rows;
}

export async function listDemoVoterGeographies() {
  const pool = await getDb();
  return voterMasterGeographies(pool);
}

export async function addDemoVoterToMaster(actor, input) {
  const voter = validateQuickAddInput(input);
  const pool = await getDb();
  const db = await pool.connect();

  try {
    await db.query("BEGIN");
    const geographies = await voterMasterGeographies(db);
    const geography = geographies.find((item) => item.id === voter.geoUnitId);
    if (!geography) {
      throw fail("Choose an active geography already used by the Voter Master", 409, "GEOGRAPHY_NOT_AVAILABLE");
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
      WHERE geo_unit_id = $1 AND is_active = TRUE
      ORDER BY id LIMIT 1
    `, [voter.geoUnitId]);
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
      JSON.stringify({ origin: "ADMIN_VOTER_MASTER_QUICK_ADD", identifierKind: "INTERNAL_DEMO",
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
      JSON.stringify({ origin: "ADMIN_VOTER_MASTER_QUICK_ADD" })]);

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
    `, [id, `Consented Admin addition from Voter Master by ${actor.id}`]);

    await db.query("COMMIT");

    return { voterId: id,
      fullName: voter.fullName, phoneEnding: voter.phoneNumber.slice(-4),
      internalDemoId, geography: geography.name };
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}
