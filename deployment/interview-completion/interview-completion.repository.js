import { campaignReviewVisibilitySql } from './campaign-visibility.repository.js';
import { getCampaignStrategicAnalytics } from './analytics-workspace.repository.js';
import { authorize, validId, UUID, InterviewCompletionError, buildInterviewCompletion, buildInterviewSummary, unavailableSummary } from './interview-completion.js';

async function verifyActor(db, actor) {
  const result = await db.query(`SELECT account.id FROM users account JOIN roles role ON role.id=account.role_id
    WHERE account.id=$1::uuid AND account.status='ACTIVE' AND role.is_active=TRUE AND role.code=$2`, [actor.id, actor.role_code]);
  if (result.rows.length !== 1) throw new InterviewCompletionError('An active authorized account is required', 'INTERVIEW_COMPLETION_FORBIDDEN', 403);
}

const sourceColumns = `execution.id AS execution_id, execution.run_contact_id, execution.run_id, execution.voter_id,
  execution.provider_attempt_id, execution.status AS execution_status, execution.callback_received_at,
  execution.created_at AS execution_created_at, execution.updated_at AS execution_updated_at, matched.updated_at AS call_updated_at,
  matched.id AS call_id, matched.connectivity_status, matched.interaction_transcript, matched.response_variables,
  (SELECT COUNT(*)::int FROM calls counted WHERE counted.attempt_id=execution.provider_attempt_id) AS call_count,
  ((SELECT COUNT(*)::int FROM call_executions other WHERE other.provider_attempt_id=execution.provider_attempt_id
    AND other.id <> execution.id)
    + (SELECT COUNT(*)::int FROM calls conflicting WHERE conflicting.attempt_id=execution.provider_attempt_id
      AND (conflicting.iteration_id IS DISTINCT FROM iteration.id OR conflicting.run_id IS DISTINCT FROM execution.run_id
        OR conflicting.voter_id IS DISTINCT FROM execution.voter_id))) AS identity_conflicts`;
const matchedCall = `LEFT JOIN LATERAL (SELECT item.* FROM calls item
  WHERE item.attempt_id=execution.provider_attempt_id AND item.run_id=execution.run_id
    AND item.iteration_id=iteration.id AND item.voter_id=execution.voter_id
  ORDER BY item.id LIMIT 1) matched ON TRUE`;

export async function getInterviewCompletionExecution(db, actor, executionId) {
  authorize(actor); executionId = validId(executionId); actor = { ...actor, id: validId(actor.id) };
  const client = await db.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await verifyActor(client, actor);
    const visibility = campaignReviewVisibilitySql(actor, 'campaign', 2);
    const source = await client.query(`SELECT ${sourceColumns}, campaign.id AS campaign_id, iteration.id AS iteration_id,
      iteration.questionnaire_id, iteration.questionnaire_snapshot
      FROM call_executions execution
      JOIN campaign_run_contacts contact ON contact.id=execution.run_contact_id AND contact.run_id=execution.run_id AND contact.voter_id=execution.voter_id
      JOIN campaign_runs run ON run.id=execution.run_id JOIN program_iterations iteration ON iteration.id=run.iteration_id
      JOIN campaign_iteration_links link ON link.iteration_id=iteration.id JOIN campaigns campaign ON campaign.id=link.campaign_id
      ${matchedCall}
      WHERE execution.id=$1::uuid AND campaign.status <> 'ARCHIVED' AND ${visibility.sql}
        AND (SELECT COUNT(*) FROM campaign_iteration_links linked WHERE linked.iteration_id=iteration.id)=1`, [executionId, ...visibility.values]);
    if (source.rows.length !== 1) throw new InterviewCompletionError('An unambiguous authorized call was not found', 'INTERVIEW_COMPLETION_NOT_FOUND', 404);
    const result = buildInterviewCompletion(source.rows[0]);
    await client.query('COMMIT'); return result;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

// Compatibility absence is detected explicitly and only after authorization.
// Network failures, permissions and arbitrary SQL errors never become zeros.
const requiredSchema = {
  program_iterations: ['questionnaire_id', 'questionnaire_snapshot'],
  campaign_runs: ['id', 'iteration_id', 'run_number'],
  campaign_run_contacts: ['id', 'run_id', 'voter_id', 'attempt_count', 'attempt_status'],
  call_executions: ['id', 'run_contact_id', 'run_id', 'voter_id', 'provider_attempt_id', 'status', 'callback_received_at', 'created_at', 'updated_at'],
  calls: ['id', 'attempt_id', 'run_id', 'iteration_id', 'voter_id', 'connectivity_status', 'interaction_transcript', 'response_variables', 'updated_at']
};
async function sourceSchemaAvailable(db) {
  const result = await db.query(`SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name=ANY($1::text[])`, [Object.keys(requiredSchema)]);
  return Object.entries(requiredSchema).every(([table, columns]) => columns.every((column) =>
    result.rows.some((row) => row.table_name === table && row.column_name === column)));
}

export async function getCampaignInterviewCompletion(db, actor, campaignId, selection = {}, dependencies = {}) {
  authorize(actor, ['SUPER_ADMIN', 'ADMIN', 'CAMPAIGN_MANAGER']); campaignId = validId(campaignId); actor = { ...actor, id: validId(actor.id) };
  if (!selection || typeof selection !== 'object' || Array.isArray(selection) || Object.keys(selection).some((key) => key !== 'iterationId')) {
    throw new InterviewCompletionError('Interview completion covers the entire Iteration; demographic and Run filters are unsupported');
  }
  if (selection.iterationId !== undefined) selection = { iterationId: validId(selection.iterationId) };
  const analysis = await (dependencies.analyze || getCampaignStrategicAnalytics)(campaignId, actor, selection);
  const iterationId = analysis.scope?.insightScope?.iterationId || null;
  if (analysis.campaign?.id !== campaignId || (iterationId && analysis.scope?.iteration?.id !== iterationId)
    || (!iterationId && analysis.scope?.iteration?.id) || (selection.iterationId && iterationId !== selection.iterationId)) {
    throw new InterviewCompletionError('Authorized research scope is inconsistent', 'INTERVIEW_COMPLETION_SCOPE_CONFLICT', 409);
  }
  const client = await db.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await verifyActor(client, actor);
    // Do not trust an earlier analysis response when a Manager was reassigned.
    const visibility = campaignReviewVisibilitySql(actor, 'campaign', 2);
    const campaigns = await client.query(`SELECT campaign.id FROM campaigns campaign
      WHERE campaign.id=$1::uuid AND campaign.status <> 'ARCHIVED' AND ${visibility.sql}`, [campaignId, ...visibility.values]);
    if (campaigns.rows.length !== 1) throw new InterviewCompletionError('Campaign was not found', 'INTERVIEW_COMPLETION_NOT_FOUND', 404);
    if (!iterationId) { await client.query('COMMIT'); return unavailableSummary(campaignId, null, 'NO_SELECTED_ITERATION'); }
    const linked = await client.query(`SELECT iteration.id FROM program_iterations iteration JOIN campaign_iteration_links link ON link.iteration_id=iteration.id
      WHERE iteration.id=$1::uuid AND link.campaign_id=$2::uuid`, [iterationId, campaignId]);
    if (linked.rows.length !== 1) throw new InterviewCompletionError('Iteration was not found', 'INTERVIEW_COMPLETION_NOT_FOUND', 404);
    const links = await client.query('SELECT COUNT(*)::int AS n FROM campaign_iteration_links WHERE iteration_id=$1::uuid', [iterationId]);
    if (links.rows[0].n !== 1) { await client.query('COMMIT'); return unavailableSummary(campaignId, iterationId, 'AMBIGUOUS_SOURCE_SCOPE'); }
    if (!await sourceSchemaAvailable(client)) { await client.query('COMMIT'); return unavailableSummary(campaignId, iterationId, 'SOURCE_SCHEMA_UNAVAILABLE'); }
    const instrument = await client.query('SELECT questionnaire_id, questionnaire_snapshot FROM program_iterations WHERE id=$1::uuid', [iterationId]);
    const runs = await client.query('SELECT id FROM campaign_runs WHERE iteration_id=$1::uuid AND run_number=1', [iterationId]);
    if (runs.rows.length !== 1) { await client.query('COMMIT'); return unavailableSummary(campaignId, iterationId); }
    const cohort = await client.query(`SELECT id, voter_id FROM campaign_run_contacts WHERE run_id=$1::uuid ORDER BY id`, [runs.rows[0].id]);
    const voters = new Set(cohort.rows.map((row) => row.voter_id));
    if (cohort.rows.some((row) => typeof row.voter_id !== 'string' || !UUID.test(row.voter_id)) || voters.size !== cohort.rows.length) {
      await client.query('COMMIT'); return unavailableSummary(campaignId, iterationId);
    }
    const rows = await client.query(`SELECT ${sourceColumns}, campaign.id AS campaign_id, iteration.id AS iteration_id,
      iteration.questionnaire_id, iteration.questionnaire_snapshot,
      (execution.id IS NOT NULL AND execution.created_at IS NULL) AS execution_chronology_unresolved,
      EXISTS (SELECT 1 FROM campaign_run_contacts attempted
        JOIN campaign_runs attempted_run ON attempted_run.id=attempted.run_id
        WHERE attempted_run.iteration_id=iteration.id AND attempted.voter_id=base.voter_id
          AND (attempted.attempt_count IS NULL OR attempted.attempt_count <> 0
            OR UPPER(COALESCE(BTRIM(attempted.attempt_status::text),'')) NOT IN ('PENDING','READY','SELECTED','NOT_ATTEMPTED'))
          AND NOT EXISTS (SELECT 1 FROM call_executions retained
            WHERE retained.run_contact_id=attempted.id AND retained.run_id=attempted.run_id AND retained.voter_id=attempted.voter_id)) AS missing_execution_evidence,
      ((execution.id IS NOT NULL AND (execution.created_at IS NULL OR execution.run_id IS DISTINCT FROM matched_run.id
        OR matched_run.iteration_id IS DISTINCT FROM iteration.id OR bound_contact.id IS NULL
        OR bound_contact.run_id IS DISTINCT FROM execution.run_id OR bound_contact.voter_id IS DISTINCT FROM execution.voter_id
        OR execution.voter_id IS DISTINCT FROM base.voter_id))
        OR EXISTS (SELECT 1 FROM calls orphan
          LEFT JOIN campaign_runs orphan_run ON orphan_run.id=orphan.run_id
          WHERE orphan.voter_id=base.voter_id AND (orphan.iteration_id=iteration.id OR orphan_run.iteration_id=iteration.id)
            AND NOT EXISTS (SELECT 1 FROM call_executions bound
              JOIN campaign_runs valid_run ON valid_run.id=bound.run_id AND valid_run.iteration_id=iteration.id
              JOIN campaign_run_contacts valid_contact ON valid_contact.id=bound.run_contact_id
                AND valid_contact.run_id=bound.run_id AND valid_contact.voter_id=bound.voter_id
              WHERE bound.provider_attempt_id=orphan.attempt_id AND bound.run_id=orphan.run_id
                AND bound.voter_id=orphan.voter_id AND orphan.iteration_id=iteration.id))) AS source_conflict
      FROM campaign_run_contacts base JOIN campaign_runs initial ON initial.id=base.run_id
      JOIN program_iterations iteration ON iteration.id=initial.iteration_id
      JOIN campaign_iteration_links link ON link.iteration_id=iteration.id JOIN campaigns campaign ON campaign.id=link.campaign_id
      LEFT JOIN LATERAL (
        SELECT candidate.* FROM call_executions candidate
        LEFT JOIN campaign_runs candidate_run ON candidate_run.id=candidate.run_id
        LEFT JOIN campaign_run_contacts candidate_contact ON candidate_contact.id=candidate.run_contact_id
        WHERE (candidate_run.iteration_id=iteration.id AND (candidate.voter_id=base.voter_id OR candidate_contact.voter_id=base.voter_id))
          OR candidate.run_contact_id IN (SELECT scoped.id FROM campaign_run_contacts scoped JOIN campaign_runs scoped_run ON scoped_run.id=scoped.run_id
            WHERE scoped_run.iteration_id=iteration.id AND scoped.voter_id=base.voter_id)
        -- Undated retained attempts cannot be declared older than a completed
        -- call. Select them first and mark chronology unresolved above.
        ORDER BY candidate.created_at DESC NULLS FIRST, candidate.updated_at DESC NULLS LAST, candidate.id DESC LIMIT 1
      ) execution ON TRUE
      LEFT JOIN campaign_runs matched_run ON matched_run.id=execution.run_id
      LEFT JOIN campaign_run_contacts bound_contact ON bound_contact.id=execution.run_contact_id
      ${matchedCall}
      WHERE campaign.id=$1::uuid AND iteration.id=$2::uuid AND initial.id=$3::uuid ORDER BY base.id`, [campaignId, iterationId, runs.rows[0].id]);
    if (rows.rows.length !== cohort.rows.length) throw new InterviewCompletionError('Retained cohort changed during assessment', 'INTERVIEW_COMPLETION_SCOPE_CONFLICT', 409);
    const result = buildInterviewSummary(campaignId, iterationId, rows.rows, instrument.rows[0]);
    await client.query('COMMIT'); return result;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
