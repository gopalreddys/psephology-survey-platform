import { getDb } from "../db/postgres.js";
import {
  validateIdentifier,
  validateIdentifierStatus,
  validateRegistration,
  validateRegistrationStatus
} from "./voter-electorate.validation.js";

async function requireVoter(client, voterId) {
  const result = await client.query(`
    SELECT id, full_name, phone_number, epic_number, app_id, is_demo_contact,
      geo_unit_id, preferred_language, contact_status, is_active
    FROM voter_master WHERE id = $1 LIMIT 1
  `, [voterId]);
  if (!result.rowCount) {
    const error = new Error("Voter not found");
    error.statusCode = 404;
    throw error;
  }
  return result.rows[0];
}

export async function getVoterElectorateProfile(voterId) {
  const db = await getDb();
  const voter = await requireVoter(db, voterId);
  const [identifiers, registrations] = await Promise.all([
    db.query(`
      SELECT id, identifier_type, identifier_value, issuing_authority, status,
        is_primary, valid_from, valid_to, source_name, created_at, updated_at
      FROM voter_identifiers
      WHERE voter_id = $1
      ORDER BY is_primary DESC, identifier_type, created_at DESC
    `, [voterId]),
    db.query(`
      SELECT registration.id, registration.electorate_type, registration.target_type,
        registration.eligibility_basis, registration.eligibility_status,
        registration.jurisdiction_id, jurisdiction.name AS jurisdiction_name,
        registration.local_body_id, local_body.name AS local_body_name,
        registration.local_body_area_id, area.name AS local_body_area_name,
        registration.target_code, registration.roll_identifier_id,
        identifier.identifier_type, identifier.identifier_value,
        registration.source_name, registration.verified_at,
        registration.valid_from, registration.valid_to,
        registration.created_at, registration.updated_at
      FROM voter_electorate_registrations registration
      LEFT JOIN jurisdictions jurisdiction ON jurisdiction.id = registration.jurisdiction_id
      LEFT JOIN local_bodies local_body ON local_body.id = registration.local_body_id
      LEFT JOIN local_body_electoral_areas area ON area.id = registration.local_body_area_id
      LEFT JOIN voter_identifiers identifier ON identifier.id = registration.roll_identifier_id
      WHERE registration.voter_id = $1
      ORDER BY registration.electorate_type, registration.created_at DESC
    `, [voterId])
  ]);
  return { voter, identifiers: identifiers.rows, registrations: registrations.rows };
}

export async function createVoterIdentifier(voterId, input, actor) {
  const parsed = validateIdentifier(input);
  const db = await getDb();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [String(voterId)]);
    await requireVoter(client, voterId);
    if (parsed.isPrimary) {
      await client.query(`
        UPDATE voter_identifiers SET is_primary = FALSE, updated_at = NOW()
        WHERE voter_id = $1 AND identifier_type = $2
          AND status IN ('ACTIVE', 'UNVERIFIED')
      `, [voterId, parsed.identifierType]);
    }
    const result = await client.query(`
      INSERT INTO voter_identifiers (
        voter_id, identifier_type, identifier_value, issuing_authority,
        status, is_primary, source_name, metadata
      ) VALUES ($1,$2,$3,$4,'UNVERIFIED',$5,$6,$7::jsonb)
      RETURNING *
    `, [
      voterId, parsed.identifierType, parsed.identifierValue,
      parsed.issuingAuthority, parsed.isPrimary, parsed.sourceName,
      JSON.stringify({ recordedByUserId: actor.id })
    ]);
    await client.query("COMMIT");
    return result.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.code === "23505") {
      const duplicate = new Error("This identifier is already registered");
      duplicate.statusCode = 409;
      throw duplicate;
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function updateVoterIdentifierStatus(voterId, identifierId, value, actor) {
  const status = validateIdentifierStatus(value);
  const db = await getDb();
  const result = await db.query(`
    UPDATE voter_identifiers
    SET status = $3,
        metadata = metadata || $4::jsonb,
        updated_at = NOW()
    WHERE id = $2 AND voter_id = $1
    RETURNING *
  `, [voterId, identifierId, status, JSON.stringify({ statusChangedByUserId: actor.id })]);
  if (!result.rowCount) {
    const error = new Error("Voter identifier not found");
    error.statusCode = 404;
    throw error;
  }
  return result.rows[0];
}

async function resolveRegistrationScope(client, parsed) {
  if (parsed.jurisdictionId) {
    const result = await client.query(`
      SELECT id, code FROM jurisdictions WHERE id = $1 AND is_active = TRUE LIMIT 1
    `, [parsed.jurisdictionId]);
    if (!result.rowCount) {
      const error = new Error("Selected constituency is not active");
      error.statusCode = 400;
      throw error;
    }
    return result.rows[0].code || null;
  }
  if (parsed.localBodyId) {
    const result = await client.query(`
      SELECT body.id, body.code
      FROM local_bodies body
      WHERE body.id = $1 AND body.is_active = TRUE
        AND ($2::uuid IS NULL OR EXISTS (
          SELECT 1 FROM local_body_electoral_areas area
          WHERE area.id = $2 AND area.local_body_id = body.id AND area.is_active = TRUE
        ))
      LIMIT 1
    `, [parsed.localBodyId, parsed.localBodyAreaId]);
    if (!result.rowCount) {
      const error = new Error("Selected local-body scope is not active");
      error.statusCode = 400;
      throw error;
    }
    return result.rows[0].code || null;
  }
  return null;
}

export async function createVoterRegistration(voterId, input, actor) {
  const parsed = validateRegistration(input);
  const db = await getDb();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [String(voterId)]);
    await requireVoter(client, voterId);
    const identifier = await client.query(`
      SELECT id, identifier_type, status
      FROM voter_identifiers
      WHERE id = $1 AND voter_id = $2 AND status IN ('ACTIVE', 'UNVERIFIED')
      LIMIT 1
    `, [parsed.rollIdentifierId, voterId]);
    if (!identifier.rowCount || identifier.rows[0].identifier_type !== parsed.expectedIdentifierType) {
      const error = new Error(`A ${parsed.expectedIdentifierType} identifier is required for this registration`);
      error.statusCode = 400;
      throw error;
    }
    const targetCode = await resolveRegistrationScope(client, parsed);
    const result = await client.query(`
      INSERT INTO voter_electorate_registrations (
        voter_id, electorate_type, target_type, jurisdiction_id,
        local_body_id, local_body_area_id, target_code, roll_identifier_id,
        eligibility_basis, eligibility_status, source_name, verified_at,
        valid_from, valid_to, metadata
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'VERIFIED',$10,NOW(),$11,$12,$13::jsonb)
      RETURNING *
    `, [
      voterId, parsed.electorateType, parsed.targetType, parsed.jurisdictionId,
      parsed.localBodyId, parsed.localBodyAreaId, targetCode,
      parsed.rollIdentifierId, parsed.eligibilityBasis, parsed.sourceName,
      parsed.validFrom, parsed.validTo,
      JSON.stringify({ verifiedByUserId: actor.id })
    ]);
    if (identifier.rows[0].status === "UNVERIFIED") {
      await client.query(`
        UPDATE voter_identifiers SET status = 'ACTIVE', updated_at = NOW()
        WHERE id = $1
      `, [parsed.rollIdentifierId]);
    }
    await client.query("COMMIT");
    return result.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.code === "23505") {
      const duplicate = new Error("This voter already has an active registration for the selected electorate");
      duplicate.statusCode = 409;
      throw duplicate;
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function updateVoterRegistrationStatus(voterId, registrationId, value, actor) {
  const status = validateRegistrationStatus(value);
  const db = await getDb();
  const result = await db.query(`
    UPDATE voter_electorate_registrations
    SET eligibility_status = $3,
        verified_at = CASE WHEN $3 IN ('ELIGIBLE', 'VERIFIED') THEN NOW() ELSE verified_at END,
        metadata = metadata || $4::jsonb,
        updated_at = NOW()
    WHERE id = $2 AND voter_id = $1
    RETURNING *
  `, [voterId, registrationId, status, JSON.stringify({ statusChangedByUserId: actor.id })]);
  if (!result.rowCount) {
    const error = new Error("Electorate registration not found");
    error.statusCode = 404;
    throw error;
  }
  return result.rows[0];
}
