import { getDb } from "../db/postgres.js";

export async function listJurisdictionTypes() {
  const db = await getDb();
  const result = await db.query(`
    SELECT id, code, name, category FROM jurisdiction_types
    WHERE is_active = TRUE ORDER BY category, name
  `);
  return result.rows;
}

export async function listJurisdictions(typeCode = null) {
  const db = await getDb();
  const params = [];
  let filter = "";
  if (typeCode) { params.push(typeCode); filter = "AND type.code = $1"; }
  const result = await db.query(`
    SELECT jurisdiction.id, jurisdiction.name, jurisdiction.code,
      type.code AS type_code, type.name AS type_name,
      jurisdiction.parent_jurisdiction_id, jurisdiction.metadata
    FROM jurisdictions jurisdiction
    JOIN jurisdiction_types type ON type.id = jurisdiction.jurisdiction_type_id
    WHERE jurisdiction.is_active = TRUE ${filter}
    ORDER BY type.name, jurisdiction.name
  `, params);
  return result.rows;
}

export async function getJurisdictionById(jurisdictionId) {
  const db = await getDb();
  const result = await db.query(`
    SELECT jurisdiction.id, jurisdiction.name, jurisdiction.code,
      type.code AS type_code, type.name AS type_name,
      jurisdiction.parent_jurisdiction_id, jurisdiction.metadata
    FROM jurisdictions jurisdiction
    JOIN jurisdiction_types type ON type.id = jurisdiction.jurisdiction_type_id
    WHERE jurisdiction.id = $1 AND jurisdiction.is_active = TRUE LIMIT 1
  `, [jurisdictionId]);
  return result.rows[0] || null;
}

export async function getJurisdictionGeographies(jurisdictionId) {
  const db = await getDb();
  const result = await db.query(`
    WITH RECURSIVE jurisdiction_tree AS (
      SELECT id FROM jurisdictions WHERE id = $1 AND is_active = TRUE
      UNION ALL
      SELECT child.id FROM jurisdictions child
      JOIN jurisdiction_tree parent ON child.parent_jurisdiction_id = parent.id
      WHERE child.is_active = TRUE
    ), ranked_mappings AS (
      SELECT geography.id, geography.parent_id, geography.name,
        geography.geo_type, geography.code, geography.population,
        geography.registered_voters, geography.urban_rural,
        mapping.coverage_type, mapping.mapping_method,
        mapping.verification_status, mapping.source_name,
        mapping.source_reference, mapping.notes,
        ROW_NUMBER() OVER (
          PARTITION BY geography.id
          ORDER BY CASE WHEN mapping.coverage_type = 'FULL' THEN 0 ELSE 1 END,
            CASE WHEN mapping.verification_status = 'SOURCE_VERIFIED' THEN 0 ELSE 1 END
        ) AS rank
      FROM jurisdiction_tree selected
      JOIN jurisdiction_geo_mapping mapping
        ON mapping.jurisdiction_id = selected.id AND mapping.is_active = TRUE
      JOIN geo_units geography
        ON geography.id = mapping.geo_unit_id AND geography.is_active = TRUE
    )
    SELECT id, parent_id, name, geo_type, code, population,
      registered_voters, urban_rural, coverage_type, mapping_method,
      verification_status, source_name, source_reference, notes
    FROM ranked_mappings WHERE rank = 1
    ORDER BY geo_type, name
  `, [jurisdictionId]);
  return result.rows;
}

export async function getEligibleVoterCount(jurisdictionId) {
  const db = await getDb();
  const result = await db.query(`
    SELECT COUNT(DISTINCT voter.id)::int AS eligible_voters
    FROM voter_master voter
    JOIN voter_jurisdiction_mapping mapping ON mapping.voter_id = voter.id
    WHERE mapping.jurisdiction_id = $1
      AND voter.is_active = TRUE AND voter.contact_status = 'ACTIVE'
  `, [jurisdictionId]);
  return result.rows[0]?.eligible_voters || 0;
}
