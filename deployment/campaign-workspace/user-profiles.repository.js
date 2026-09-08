import { getDb } from "../db/postgres.js";

const adminRoles = new Set(["SUPER_ADMIN", "ADMIN"]);

const profileFields = {
  addressLine1: "address_line_1",
  addressLine2: "address_line_2",
  villageName: "village_name",
  mandalName: "mandal_name",
  districtName: "district_name",
  stateName: "state_name",
  postalCode: "postal_code"
};

function accessError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function assertSelfOrAdmin(targetUserId, actor) {
  if (!actor?.id) throw accessError("Authenticated platform user is required", 401);
  if (actor.id !== targetUserId && !adminRoles.has(actor.role_code)) {
    throw accessError("You may access only your own profile", 403);
  }
}

async function audit(db, actorUserId, targetUserId, action, metadata = {}) {
  await db.query(`
    INSERT INTO user_profile_access_audit
      (actor_user_id, target_user_id, action, metadata)
    VALUES ($1, $2, $3, $4::jsonb)
  `, [actorUserId, targetUserId, action, JSON.stringify(metadata)]);
}

export async function getUserProfile(targetUserId, actor) {
  assertSelfOrAdmin(targetUserId, actor);
  const db = await getDb();
  const result = await db.query(`
    SELECT
      u.id,
      u.full_name,
      u.email,
      u.phone_number,
      u.status,
      u.designation,
      u.organization_name,
      u.created_at,
      u.last_login_at,
      r.code AS role_code,
      r.name AS role_name,
      p.photo_content_type,
      p.photo_uploaded_at,
      p.address_line_1,
      p.address_line_2,
      p.village_name,
      p.mandal_name,
      p.district_name,
      p.state_name,
      p.postal_code,
      p.govt_id_type,
      p.govt_id_last4,
      p.govt_id_uploaded_at,
      p.govt_id_verified,
      p.govt_id_verified_at
    FROM users u
    JOIN roles r ON r.id = u.role_id
    LEFT JOIN user_profiles p ON p.user_id = u.id
    WHERE u.id = $1
    LIMIT 1
  `, [targetUserId]);

  if (!result.rowCount) throw accessError("User not found", 404);
  const geographyResult = await db.query(`
    SELECT
      assignment.geo_unit_id AS id,
      geography.name,
      geography.geo_type,
      geography.code,
      assignment.access_level
    FROM user_geo_assignments assignment
    JOIN geo_units geography ON geography.id = assignment.geo_unit_id
    WHERE assignment.user_id = $1
      AND assignment.is_active = TRUE
      AND geography.is_active = TRUE
    ORDER BY geography.geo_type, geography.name
  `, [targetUserId]);

  await audit(db, actor.id, targetUserId, adminRoles.has(actor.role_code) ? "VIEW_GOVT_ID" : "VIEW");
  return { ...result.rows[0], geographies: geographyResult.rows };
}

export async function updateUserProfile(targetUserId, payload, actor) {
  assertSelfOrAdmin(targetUserId, actor);
  const db = await getDb();
  const updates = [];
  const values = [];

  for (const [input, column] of Object.entries(profileFields)) {
    if (Object.prototype.hasOwnProperty.call(payload || {}, input)) {
      updates.push(`${column} = $${values.length + 1}`);
      values.push(payload[input] === "" ? null : payload[input]);
    }
  }

  if (Object.prototype.hasOwnProperty.call(payload || {}, "govtIdType") ||
      Object.prototype.hasOwnProperty.call(payload || {}, "govtIdLast4") ||
      Object.prototype.hasOwnProperty.call(payload || {}, "govtIdVerified")) {
    if (!adminRoles.has(actor.role_code)) {
      throw accessError("Only Admin or Super Admin can update government identity details", 403);
    }
    if (Object.prototype.hasOwnProperty.call(payload, "govtIdType")) {
      updates.push(`govt_id_type = $${values.length + 1}`);
      values.push(payload.govtIdType === "" ? null : payload.govtIdType);
    }
    if (Object.prototype.hasOwnProperty.call(payload, "govtIdLast4")) {
      const last4 = payload.govtIdLast4 === "" ? null : String(payload.govtIdLast4);
      if (last4 && !/^[0-9A-Za-z]{4}$/.test(last4)) {
        throw accessError("Government ID reference must contain exactly four letters or digits", 400);
      }
      updates.push(`govt_id_last4 = $${values.length + 1}`);
      values.push(last4);
    }
    if (Object.prototype.hasOwnProperty.call(payload, "govtIdVerified")) {
      const verified = Boolean(payload.govtIdVerified);
      updates.push(`govt_id_verified = $${values.length + 1}`);
      values.push(verified);
      updates.push(`govt_id_verified_by = $${values.length + 1}`);
      values.push(verified ? actor.id : null);
      updates.push(`govt_id_verified_at = ${verified ? "NOW()" : "NULL"}`);
    }
  }

  if (!updates.length) throw accessError("No profile changes were supplied", 400);
  updates.push("updated_at = NOW()");
  values.push(targetUserId);

  await db.query(`
    INSERT INTO user_profiles (user_id, updated_at)
    VALUES ($1, NOW())
    ON CONFLICT (user_id) DO NOTHING
  `, [targetUserId]);

  await db.query(`
    UPDATE user_profiles
    SET ${updates.join(",\n        ")}
    WHERE user_id = $${values.length}
  `, values);

  await audit(db, actor.id, targetUserId, adminRoles.has(actor.role_code) ? "UPDATE_GOVT_ID" : "UPDATE");
  return getUserProfile(targetUserId, { ...actor, id: actor.id });
}
