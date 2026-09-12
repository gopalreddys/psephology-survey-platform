/**
 * Selects voters only from the Campaigner's active work allocation.
 * Pass the same transaction client used by createInitialRun.
 */
export async function selectAssignedVoters(db, {
  iterationId,
  campaignerUserId,
  runNumber = 1,
  targetContacts,
  sourceName = null
}) {
  const contextResult = await db.query(`
    SELECT
      iteration.id,
      link.campaign_id,
      COALESCE(link.status, iteration.status) AS iteration_status
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

  if (
    ["COMPLETED", "LOCKED"].includes(
      String(contextResult.rows[0].iteration_status).toUpperCase()
    )
  ) {
    const error = new Error("Runs cannot be created after an iteration is completed");
    error.statusCode = 409;
    throw error;
  }

  const campaignId = contextResult.rows[0].campaign_id;
  const assignmentResult = await db.query(`
    SELECT 1
    FROM campaign_work_allocations allocation
    WHERE allocation.campaign_id = $1
      AND (allocation.iteration_id = $3 OR allocation.iteration_id IS NULL)
      AND allocation.campaigner_user_id = $2
      AND allocation.status <> 'REASSIGNED'
    LIMIT 1
  `, [campaignId, campaignerUserId, iterationId]);

  if (!assignmentResult.rowCount) {
    const error = new Error("Campaigner has no active allocation for this iteration");
    error.statusCode = 403;
    throw error;
  }

  if (runNumber > 1) {
    const previousRunResult = await db.query(`
      SELECT id, status
      FROM campaign_runs
      WHERE iteration_id = $1
        AND run_number = $2
      LIMIT 1
    `, [iterationId, runNumber - 1]);

    if (!previousRunResult.rowCount) {
      const error = new Error(`Run ${runNumber - 1} must be created before Run ${runNumber}`);
      error.statusCode = 409;
      throw error;
    }

    if (!["COMPLETED", "FAILED"].includes(previousRunResult.rows[0].status)) {
      const error = new Error(`Run ${runNumber - 1} must be completed before Run ${runNumber}`);
      error.statusCode = 409;
      throw error;
    }

    const result = await db.query(`
      WITH RECURSIVE allocated_roots AS (
        SELECT allocation.geo_unit_id
        FROM campaign_work_allocations allocation
        WHERE allocation.campaign_id = $3
          AND (allocation.iteration_id = $4 OR allocation.iteration_id IS NULL)
          AND allocation.campaigner_user_id = $5
          AND allocation.status <> 'REASSIGNED'
          AND allocation.geo_unit_id IS NOT NULL

        UNION

        SELECT area_mapping.geo_unit_id
        FROM campaign_work_allocations allocation
        JOIN local_body_area_geo_mapping area_mapping
          ON area_mapping.electoral_area_id = allocation.local_body_area_id
         AND area_mapping.is_active = TRUE
        WHERE allocation.campaign_id = $3
          AND (allocation.iteration_id = $4 OR allocation.iteration_id IS NULL)
          AND allocation.campaigner_user_id = $5
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
      FROM campaign_run_contacts previous_contact
      JOIN voter_master voter
        ON voter.id = previous_contact.voter_id
      JOIN allocated_geography geography
        ON geography.geo_unit_id = voter.geo_unit_id
      WHERE previous_contact.run_id = $1
        AND voter.is_active = TRUE
        AND voter.contact_status = 'ACTIVE'
        AND voter.is_demo_contact = TRUE
        AND (voter.qualification IS NULL OR length(trim(voter.qualification)) = 0)
        AND ($2::text IS NULL OR voter.source_name = $2)
        AND previous_contact.retry_eligible = TRUE
        AND previous_contact.retry_exhausted = FALSE
        AND COALESCE(previous_contact.final_status, 'UNRESOLVED') NOT IN (
          'SUCCESS_PULSE', 'SUCCESS_COMPLETE', 'SUCCESS_SUBSTANTIAL',
          'REFUSED_TERMINAL', 'DO_NOT_CALL', 'INVALID_NUMBER'
        )
      ORDER BY voter.id
    `, [
      previousRunResult.rows[0].id,
      sourceName,
      campaignId,
      iterationId,
      campaignerUserId
    ]);

    if (!result.rowCount) {
      const error = new Error(`Run ${runNumber - 1} has no unresolved contacts; no new Run is required`);
      error.statusCode = 409;
      throw error;
    }

    return result.rows;
  }

  const result = await db.query(`
    WITH RECURSIVE allocated_roots AS (
      SELECT allocation.geo_unit_id AS geo_unit_id
      FROM campaign_work_allocations allocation
      WHERE allocation.campaign_id = $1
        AND (allocation.iteration_id = $3 OR allocation.iteration_id IS NULL)
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
        AND (allocation.iteration_id = $3 OR allocation.iteration_id IS NULL)
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
      AND voter.is_demo_contact = TRUE
      AND (voter.qualification IS NULL OR length(trim(voter.qualification)) = 0)
      AND ($4::text IS NULL OR voter.source_name = $4)
      AND NOT EXISTS (
        SELECT 1
        FROM campaign_run_contacts existing_contact
        JOIN campaign_runs existing_run
          ON existing_run.id = existing_contact.run_id
        WHERE existing_contact.voter_id = voter.id
          AND existing_run.iteration_id = $5
          AND existing_run.status NOT IN ('COMPLETED', 'FAILED', 'CANCELLED', 'ARCHIVED')
          AND COALESCE(existing_contact.final_status, 'UNRESOLVED') NOT IN (
            'SUCCESS_PULSE', 'SUCCESS_COMPLETE', 'SUCCESS_SUBSTANTIAL',
            'REFUSED_TERMINAL', 'DO_NOT_CALL', 'INVALID_NUMBER'
          )
      )
    ORDER BY voter.id
    LIMIT $6
    `, [campaignId, campaignerUserId, iterationId, sourceName, iterationId, targetContacts]);

  return result.rows;
}
