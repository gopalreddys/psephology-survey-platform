/**
 * Selects voters only from the Campaigner's active work allocation.
 * Pass the same transaction client used by createInitialRun.
 */
export async function selectAssignedVoters(db, {
  iterationId,
  campaignerUserId,
  targetContacts,
  sourceName = null
}) {
  const contextResult = await db.query(`
    SELECT iteration.id, link.campaign_id
    FROM program_iterations iteration
    JOIN campaign_iteration_links link
      ON link.iteration_id = iteration.id
    JOIN campaigns campaign
      ON campaign.id = link.campaign_id
    WHERE iteration.id = $1
      AND campaign.status <> 'ARCHIVED'
    LIMIT 1
  `, [iterationId]);

  if (!contextResult.rowCount) {
    const error = new Error("Iteration is not linked to an active campaign");
    error.statusCode = 403;
    throw error;
  }

  const campaignId = contextResult.rows[0].campaign_id;
  const assignmentResult = await db.query(`
    SELECT 1
    FROM campaign_work_allocations allocation
    WHERE allocation.campaign_id = $1
      AND allocation.campaigner_user_id = $2
      AND allocation.status <> 'REASSIGNED'
    LIMIT 1
  `, [campaignId, campaignerUserId]);

  if (!assignmentResult.rowCount) {
    const error = new Error("Campaigner has no active allocation for this campaign");
    error.statusCode = 403;
    throw error;
  }

  const result = await db.query(`
    WITH RECURSIVE allocated_roots AS (
      SELECT allocation.geo_unit_id AS geo_unit_id
      FROM campaign_work_allocations allocation
      WHERE allocation.campaign_id = $1
        AND allocation.campaigner_user_id = $2
        AND allocation.status <> 'REASSIGNED'
        AND allocation.geo_unit_id IS NOT NULL

      UNION

      SELECT area_mapping.geo_unit_id
      FROM campaign_work_allocations allocation
      JOIN local_body_area_geo_mapping area_mapping
        ON area_mapping.electoral_area_id = allocation.local_body_area_id
       AND area_mapping.is_active = TRUE
      WHERE allocation.campaign_id = $1
        AND allocation.campaigner_user_id = $2
        AND allocation.status <> 'REASSIGNED'
        AND allocation.local_body_area_id IS NOT NULL
    ), allocated_geography AS (
      SELECT geo_unit_id FROM allocated_roots

      UNION

      SELECT child.id
      FROM allocated_geography parent
      JOIN geo_units child
        ON child.parent_id = parent.geo_unit_id
       AND child.is_active = TRUE
    )
    SELECT voter.id
    FROM voter_master voter
    JOIN allocated_geography geography
      ON geography.geo_unit_id = voter.geo_unit_id
    WHERE voter.is_active = TRUE
      AND voter.contact_status = 'ACTIVE'
      AND ($3::text IS NULL OR voter.source_name = $3)
      AND NOT EXISTS (
        SELECT 1
        FROM campaign_run_contacts existing_contact
        JOIN campaign_runs existing_run
          ON existing_run.id = existing_contact.run_id
        WHERE existing_contact.voter_id = voter.id
          AND existing_run.iteration_id = $4
          AND existing_run.status NOT IN ('COMPLETED', 'FAILED', 'CANCELLED', 'ARCHIVED')
          AND existing_contact.final_status NOT IN (
            'SUCCESS_PULSE', 'SUCCESS_COMPLETE', 'SUCCESS_SUBSTANTIAL',
            'REFUSED_TERMINAL', 'DO_NOT_CALL', 'INVALID_NUMBER'
          )
      )
    ORDER BY voter.id
    LIMIT $5
  `, [campaignId, campaignerUserId, sourceName, iterationId, targetContacts]);

  return result.rows;
}
