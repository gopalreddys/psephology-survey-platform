import { campaignReviewVisibilitySql } from './campaign-visibility.repository.js';
import { ResearchDesignError, validateResearchDesign } from './research-methodology-validation.js';
export { ResearchDesignError, permittedSamplingMethods } from './research-methodology-validation.js';

function authorize(actor) {
  if (!actor?.id || !['SUPER_ADMIN', 'ADMIN'].includes(actor.role_code)) {
    throw new ResearchDesignError('Admin or Super Admin access is required', 'RESEARCH_DESIGN_FORBIDDEN', 403);
  }
}

export async function saveResearchDesign(db, actor, iterationId, body) {
  authorize(actor);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(iterationId)) {
    throw new ResearchDesignError('A valid Iteration ID is required', 'INVALID_ITERATION_ID');
  }
  const design = validateResearchDesign(body);
  const visibility = campaignReviewVisibilitySql(actor, 'campaign', 2);
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    // Lock the Iteration even before its first registry row exists, so two first
    // declarations cannot both claim revision 1. Campaign privacy is checked here.
    const target = await client.query(`
      SELECT iteration.id, campaign.id AS campaign_id
      FROM program_iterations iteration
      JOIN campaign_iteration_links link ON link.iteration_id = iteration.id
      JOIN campaigns campaign ON campaign.id = link.campaign_id
      WHERE iteration.id = $1::uuid AND campaign.status <> 'ARCHIVED'
        AND ${visibility.sql}
      ORDER BY link.created_at, campaign.id LIMIT 1
      FOR UPDATE OF iteration, campaign, link
    `, [iterationId, ...visibility.values]);
    if (!target.rows.length) {
      throw new ResearchDesignError('Iteration was not found', 'ITERATION_NOT_FOUND', 404);
    }
    const current = await client.query(`
      SELECT revision FROM analytics_research_design_registry
      WHERE iteration_id = $1::uuid FOR UPDATE
    `, [iterationId]);
    if (Number(current.rows[0]?.revision || 0) !== design.expectedRevision) {
      throw new ResearchDesignError('Another declaration was saved. Refresh the registry before making further changes', 'RESEARCH_DESIGN_REVISION_CONFLICT', 409);
    }
    const campaignId = target.rows[0].campaign_id;
    const saved = await client.query(`
      INSERT INTO analytics_research_design_registry (
        iteration_id, campaign_id, target_population, sample_frame_name,
        sampling_method, selection_method, cohort_design, weighting_status,
        weighting_method, weighting_variables, fieldwork_mode, methodology_notes,
        declared_by_user_id, declared_at, updated_at, revision
      ) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8,
        NULLIF($9, ''), $10::jsonb, $11, NULLIF($12, ''), $13::uuid, now(), now(), $14)
      ON CONFLICT (iteration_id) DO UPDATE SET
        campaign_id = EXCLUDED.campaign_id, target_population = EXCLUDED.target_population,
        sample_frame_name = EXCLUDED.sample_frame_name, sampling_method = EXCLUDED.sampling_method,
        selection_method = EXCLUDED.selection_method, cohort_design = EXCLUDED.cohort_design,
        weighting_status = EXCLUDED.weighting_status, weighting_method = EXCLUDED.weighting_method,
        weighting_variables = EXCLUDED.weighting_variables, fieldwork_mode = EXCLUDED.fieldwork_mode,
        methodology_notes = EXCLUDED.methodology_notes, declared_by_user_id = EXCLUDED.declared_by_user_id,
        declared_at = EXCLUDED.declared_at, updated_at = now(), revision = EXCLUDED.revision
      RETURNING *
    `, [iterationId, campaignId, design.targetPopulation, design.sampleFrameName,
      design.samplingMethod, design.selectionMethod, design.cohortDesign,
      design.weightingStatus, design.weightingMethod, JSON.stringify(design.weightingVariables),
      design.fieldworkMode, design.methodologyNotes, actor.id, design.expectedRevision + 1]);
    const row = saved.rows[0];
    await client.query(`
      INSERT INTO analytics_research_design_audit (
        iteration_id, campaign_id, revision, actor_user_id, change_reason,
        design_snapshot, declared_at
      ) VALUES ($1::uuid, $2::uuid, $3, $4::uuid, $5, $6::jsonb, $7)
    `, [iterationId, campaignId, row.revision, actor.id, design.changeReason,
      JSON.stringify({ ...row, attested: true }), row.declared_at]);
    const result = await client.query(`
      SELECT * FROM analytics_research_design_registry_v2 WHERE iteration_id = $1::uuid
    `, [iterationId]);
    if (!result.rows[0]) throw new Error('Saved methodology is missing from the registry view');
    await client.query('COMMIT');
    return result.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function researchDesignHistory(db, actor, iterationId) {
  authorize(actor);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(iterationId)) {
    throw new ResearchDesignError('A valid Iteration ID is required', 'INVALID_ITERATION_ID');
  }
  const visibility = campaignReviewVisibilitySql(actor, 'campaign', 2);
  const target = await db.query(`
    SELECT iteration.id FROM program_iterations iteration
    JOIN campaign_iteration_links link ON link.iteration_id = iteration.id
    JOIN campaigns campaign ON campaign.id = link.campaign_id
    WHERE iteration.id = $1::uuid AND campaign.status <> 'ARCHIVED' AND ${visibility.sql}
  `, [iterationId, ...visibility.values]);
  if (!target.rows.length) throw new ResearchDesignError('Iteration was not found', 'ITERATION_NOT_FOUND', 404);
  const result = await db.query(`
    SELECT revision, actor_user_id, change_reason, design_snapshot, declared_at
    FROM analytics_research_design_audit WHERE iteration_id = $1::uuid
    ORDER BY revision DESC LIMIT 50
  `, [iterationId]);
  return result.rows.map((row) => ({
    revision: row.revision, actorUserId: row.actor_user_id,
    changeReason: row.change_reason, design: row.design_snapshot, declaredAt: row.declared_at
  }));
}
