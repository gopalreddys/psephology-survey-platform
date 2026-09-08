import { getDb } from "../db/postgres.js";

const adminRoles = new Set(["SUPER_ADMIN", "ADMIN"]);
const supportedRoles = new Set(["SUPER_ADMIN", "ADMIN", "CAMPAIGN_MANAGER", "CAMPAIGNER"]);

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

export async function changeUserRole(targetUserId, newRoleCode, actor) {
  if (!adminRoles.has(actor?.role_code)) {
    throw accessError("Only Admin or Super Admin can change user roles", 403);
  }
  if (actor.id === targetUserId) {
    throw accessError("You cannot change your own role", 409);
  }
  const roleCode = String(newRoleCode || "").trim().toUpperCase();
  if (!supportedRoles.has(roleCode)) {
    throw accessError("Unsupported platform role", 400);
  }
  if (actor.role_code === "ADMIN" && roleCode === "SUPER_ADMIN") {
    throw accessError("Only Super Admin can assign the Super Admin role", 403);
  }

  const db = await getDb();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const targetResult = await client.query(`
      SELECT u.id, u.email, u.full_name, u.status, r.code AS current_role_code
      FROM users u
      JOIN roles r ON r.id = u.role_id
      WHERE u.id = $1
      FOR UPDATE
    `, [targetUserId]);
    if (!targetResult.rowCount) throw accessError("User not found", 404);

    const target = targetResult.rows[0];
    if (actor.role_code === "ADMIN" && target.current_role_code === "SUPER_ADMIN") {
      throw accessError("Admin cannot change a Super Admin role", 403);
    }
    if (target.current_role_code === roleCode) {
      await client.query("COMMIT");
      return { ...target, role_code: target.current_role_code };
    }

    const nextRoleResult = await client.query(`
      SELECT id, code
      FROM roles
      WHERE code = $1 AND is_active = TRUE
      LIMIT 1
    `, [roleCode]);
    if (!nextRoleResult.rowCount) throw accessError("Requested role is not active", 400);

    if (target.current_role_code === "SUPER_ADMIN" && target.status === "ACTIVE") {
      const countResult = await client.query(`
        SELECT COUNT(*)::int AS count
        FROM users u
        JOIN roles r ON r.id = u.role_id
        WHERE r.code = 'SUPER_ADMIN' AND u.status = 'ACTIVE'
      `);
      if (Number(countResult.rows[0].count) <= 1) {
        throw accessError("The last active Super Admin cannot be demoted", 409);
      }
    }

    await client.query(
      "UPDATE users SET role_id = $1, updated_at = NOW() WHERE id = $2",
      [nextRoleResult.rows[0].id, targetUserId]
    );
    await client.query(`
      INSERT INTO user_role_change_audit
        (actor_user_id, target_user_id, previous_role_code, new_role_code)
      VALUES ($1, $2, $3, $4)
    `, [actor.id, targetUserId, target.current_role_code, roleCode]);
    await client.query("COMMIT");
    return { ...target, role_code: roleCode };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
