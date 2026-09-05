import { getDb } from "../db/postgres.js";

export async function listLocalBodies({ bodyType = null, search = null, limit = 10000, offset = 0 } = {}) {
  const db = await getDb();
  const safeLimit = Math.min(Math.max(Number(limit) || 1000, 1), 10000);
  const safeOffset = Math.max(Number(offset) || 0, 0);
  const result = await db.query(`
    SELECT lb.id, lb.parent_local_body_id, lb.name, lb.code, lb.body_type,
      lb.governance_level, lb.verification_status,
      COUNT(*) OVER()::int AS total_count,
      COUNT(DISTINCT area.id)::int AS electoral_area_count,
      COALESCE(jsonb_agg(DISTINCT jsonb_build_object(
        'id', geo.id, 'name', geo.name, 'geo_type', geo.geo_type, 'code', geo.code
      )) FILTER (WHERE geo.id IS NOT NULL), '[]'::jsonb) AS administrative_units
    FROM local_bodies lb
    LEFT JOIN local_body_geo_mapping mapping
      ON mapping.local_body_id = lb.id AND mapping.is_active = TRUE
    LEFT JOIN geo_units geo ON geo.id = mapping.geo_unit_id AND geo.is_active = TRUE
    LEFT JOIN local_body_electoral_areas area
      ON area.local_body_id = lb.id AND area.is_active = TRUE
    WHERE lb.is_active = TRUE
      AND ($1::text IS NULL OR lb.body_type = $1)
      AND ($2::text IS NULL OR lb.name ILIKE '%' || $2 || '%' OR lb.code ILIKE '%' || $2 || '%')
    GROUP BY lb.id
    ORDER BY lb.body_type, lb.name, lb.code
    LIMIT $3 OFFSET $4
  `, [bodyType, search, safeLimit, safeOffset]);
  return {
    items: result.rows.map(function (row) { const { total_count, ...item } = row; return item; }),
    total: Number(result.rows[0]?.total_count || 0), limit: safeLimit, offset: safeOffset
  };
}

export async function listLocalBodyElectoralAreas(localBodyId, { limit = 5000, offset = 0 } = {}) {
  const db = await getDb();
  const safeLimit = Math.min(Math.max(Number(limit) || 500, 1), 5000);
  const safeOffset = Math.max(Number(offset) || 0, 0);
  const result = await db.query(`
    SELECT area.id, area.parent_area_id, area.name, area.code, area.area_type,
      area.display_label, area.contested_office_type, area.verification_status,
      COUNT(*) OVER()::int AS total_count
    FROM local_body_electoral_areas area
    WHERE area.local_body_id = $1 AND area.is_active = TRUE
    ORDER BY area.area_type, area.name, area.code
    LIMIT $2 OFFSET $3
  `, [localBodyId, safeLimit, safeOffset]);
  return {
    items: result.rows.map(function (row) { const { total_count, ...item } = row; return item; }),
    total: Number(result.rows[0]?.total_count || 0), limit: safeLimit, offset: safeOffset
  };
}
