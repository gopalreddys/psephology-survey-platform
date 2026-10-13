import { campaignReviewVisibilitySql } from './campaign-visibility.repository.js';
import { resolveResearchScope } from './research-scope.repository.js';
import { authorize, validId, validateReview, validateDecision, CallQualityError, normalizationRulesHash,
  buildReviewDetail, buildReviewSummary, unavailableSummary } from './call-quality-review.js';

async function verifyActiveActor(db, actor, lock = false) {
  const result = await db.query(`
    SELECT account.id FROM users account JOIN roles role ON role.id = account.role_id
    WHERE account.id = $1::uuid AND account.status = 'ACTIVE' AND role.is_active = TRUE AND role.code = $2
    ${lock ? 'FOR SHARE OF account, role' : ''}
  `, [actor.id, actor.role_code]);
  if (result.rows.length !== 1) throw new CallQualityError('An active authorized account is required', 'CALL_QUALITY_FORBIDDEN', 403);
}

// The call join does NOT reuse the broad operations-page attempt-only lookup.
// It binds all four source identities and checks for conflicting provider IDs.
const sourceProjection = `
  execution.id AS execution_id, execution.run_contact_id, execution.run_id, execution.voter_id,
  execution.provider_attempt_id, execution.status AS execution_status, execution.callback_received_at,
  execution.request_payload, campaign.id AS campaign_id, iteration.id AS iteration_id,
  iteration.questionnaire_id, iteration.questionnaire_snapshot,
  matched.id AS call_id, matched.connectivity_status, matched.interaction_transcript, matched.response_variables,
  (SELECT COUNT(*)::int FROM calls counted WHERE counted.attempt_id = execution.provider_attempt_id) AS call_count,
  ((SELECT COUNT(*)::int FROM call_executions other WHERE other.provider_attempt_id = execution.provider_attempt_id
      AND other.id <> execution.id)
    + (SELECT COUNT(*)::int FROM calls conflicting WHERE conflicting.attempt_id = execution.provider_attempt_id
      AND (conflicting.iteration_id IS DISTINCT FROM iteration.id OR conflicting.run_id IS DISTINCT FROM run.id
        OR conflicting.voter_id IS DISTINCT FROM execution.voter_id))) AS identity_conflicts
`;
const sourceJoins = `
  FROM call_executions execution
  JOIN campaign_run_contacts contact ON contact.id = execution.run_contact_id
    AND contact.run_id = execution.run_id AND contact.voter_id = execution.voter_id
  JOIN campaign_runs run ON run.id = execution.run_id
  JOIN program_iterations iteration ON iteration.id = run.iteration_id
  JOIN campaign_iteration_links link ON link.iteration_id = iteration.id
  JOIN campaigns campaign ON campaign.id = link.campaign_id
  LEFT JOIN LATERAL (
    SELECT item.* FROM calls item
    WHERE item.attempt_id = execution.provider_attempt_id AND item.run_id = execution.run_id
      AND item.iteration_id = iteration.id AND item.voter_id = execution.voter_id
    ORDER BY item.id LIMIT 1
  ) matched ON TRUE
`;

async function sourceForExecution(db, actor, executionId, lock = false) {
  const visibility = campaignReviewVisibilitySql(actor, 'campaign', 2);
  // Lock the same Iteration/execution/campaign before reading retained evidence.
  // Writes never update a transcript, callback, provider record or source snapshot.
  const target = await db.query(`
    SELECT execution.id AS execution_id, iteration.id AS iteration_id, campaign.id AS campaign_id
    FROM call_executions execution
    JOIN campaign_run_contacts contact ON contact.id = execution.run_contact_id
      AND contact.run_id = execution.run_id AND contact.voter_id = execution.voter_id
    JOIN campaign_runs run ON run.id = execution.run_id
    JOIN program_iterations iteration ON iteration.id = run.iteration_id
    JOIN campaign_iteration_links link ON link.iteration_id = iteration.id
    JOIN campaigns campaign ON campaign.id = link.campaign_id
    WHERE execution.id = $1::uuid AND campaign.status <> 'ARCHIVED' AND ${visibility.sql}
      AND (SELECT COUNT(*) FROM campaign_iteration_links linked WHERE linked.iteration_id = iteration.id) = 1
    ${lock ? 'FOR UPDATE OF iteration, execution, campaign, link, contact, run' : ''}
  `, [executionId, ...visibility.values]);
  if (target.rows.length !== 1) throw new CallQualityError('An unambiguous authorized call was not found', 'CALL_QUALITY_NOT_FOUND', 404);
  if (lock) await db.query(`
    SELECT matched.id FROM calls matched JOIN call_executions execution ON matched.attempt_id = execution.provider_attempt_id
    WHERE execution.id = $1::uuid ORDER BY matched.id FOR UPDATE OF matched
  `, [executionId]);
  const source = await db.query(`
    SELECT ${sourceProjection} ${sourceJoins}
    WHERE execution.id = $1::uuid AND campaign.id = $2::uuid AND iteration.id = $3::uuid
      AND campaign.status <> 'ARCHIVED'
  `, [executionId, target.rows[0].campaign_id, target.rows[0].iteration_id]);
  if (source.rows.length !== 1) throw new CallQualityError('Call evidence changed; refresh the review', 'CALL_QUALITY_SOURCE_CONFLICT', 409);
  return source.rows[0];
}

const eligibleActor = `(account.id IS NOT NULL AND account.status = 'ACTIVE' AND role.is_active = TRUE
  AND (role.code = 'SUPER_ADMIN' OR (role.code = 'ADMIN'
    AND (campaign.campaign_manager_user_id IS NOT NULL OR campaign.created_by_user_id = account.id))))`;
async function auditRows(db, campaignId, iterationId, executionId = null, lock = false) {
  const values = [campaignId, iterationId, executionId];
  if (lock) await db.query(`
    SELECT account.id FROM users account JOIN roles role ON role.id = account.role_id
    WHERE account.id IN (
      SELECT actor_user_id FROM call_quality_reviews WHERE campaign_id=$1::uuid AND iteration_id=$2::uuid AND execution_id=$3::uuid
      UNION SELECT actor_user_id FROM call_quality_decisions WHERE campaign_id=$1::uuid AND iteration_id=$2::uuid AND execution_id=$3::uuid)
    ORDER BY account.id FOR SHARE OF account, role
  `, values);
  const reviews = await db.query(`
    SELECT audit.*, ${eligibleActor} AS eligible
    FROM call_quality_reviews audit JOIN campaigns campaign ON campaign.id = audit.campaign_id
    LEFT JOIN users account ON account.id = audit.actor_user_id LEFT JOIN roles role ON role.id = account.role_id
    WHERE audit.campaign_id = $1::uuid AND audit.iteration_id = $2::uuid
      AND ($3::uuid IS NULL OR audit.execution_id = $3::uuid)
    ORDER BY audit.created_at, audit.id
  `, values);
  const decisions = await db.query(`
    SELECT audit.*, ${eligibleActor} AS eligible
    FROM call_quality_decisions audit JOIN campaigns campaign ON campaign.id = audit.campaign_id
    LEFT JOIN users account ON account.id = audit.actor_user_id LEFT JOIN roles role ON role.id = account.role_id
    WHERE audit.campaign_id = $1::uuid AND audit.iteration_id = $2::uuid
      AND ($3::uuid IS NULL OR audit.execution_id = $3::uuid)
    ORDER BY audit.revision DESC
  `, values);
  return { reviews: reviews.rows, decisions: decisions.rows };
}

async function loadDetail(db, actor, executionId, dependencies = {}, lock = false) {
  const source = await sourceForExecution(db, actor, executionId, lock);
  const audit = await auditRows(db, source.campaign_id, source.iteration_id, executionId, lock);
  const ruleHash = (dependencies.normalizationRulesHash || normalizationRulesHash)();
  return { source, detail: buildReviewDetail(source, actor, audit.reviews, audit.decisions, ruleHash) };
}

export async function getCallQualityExecution(db, actor, executionId, dependencies = {}) {
  authorize(actor); executionId = validId(executionId); actor = { ...actor, id: validId(actor.id) };
  const client = await db.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await verifyActiveActor(client, actor);
    const { detail } = await loadDetail(client, actor, executionId, dependencies);
    await client.query('COMMIT');
    return detail;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

function verifyExpected(detail, body) {
  if (!detail.reviewable || !detail.evidenceFingerprint) throw new CallQualityError('A resolved matched connected transcript is required', 'CALL_QUALITY_NOT_REVIEWABLE', 409);
  if (detail.evidenceFingerprint !== body.expectedEvidenceFingerprint) throw new CallQualityError('Evidence changed; refresh and review the new evidence', 'CALL_QUALITY_EVIDENCE_CONFLICT', 409);
}

async function mutate(db, actor, executionId, body, kind, dependencies) {
  authorize(actor); executionId = validId(executionId); actor = { ...actor, id: validId(actor.id) };
  const input = kind === 'review' ? validateReview(body) : validateDecision(body);
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await verifyActiveActor(client, actor, true);
    const { source, detail } = await loadDetail(client, actor, executionId, dependencies, true);
    verifyExpected(detail, input);
    if (kind === 'review') {
      if (!detail.permissions.canReview) throw new CallQualityError('Your independent review of this evidence is already recorded', 'CALL_QUALITY_REVIEW_EXISTS', 409);
      if (detail.decision?.evidenceFingerprint === detail.evidenceFingerprint && detail.decision.action === 'APPROVE_SAMPLE') {
        throw new CallQualityError('This sample already has an approval; a changed source requires a fresh review', 'CALL_QUALITY_DECISION_CLOSED', 409);
      }
      await client.query(`
        INSERT INTO call_quality_reviews (execution_id, campaign_id, iteration_id, run_id, actor_user_id,
          evidence_fingerprint, language, checks, issue_buckets, note, attested)
        VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6,$7,$8::jsonb,$9::text[],$10,TRUE)
      `, [executionId, source.campaign_id, source.iteration_id, source.run_id, actor.id,
        detail.evidenceFingerprint, input.language, JSON.stringify(input.checks), input.issueBuckets, input.note]);
    } else {
      if (detail.decisionRevision !== input.expectedDecisionRevision) throw new CallQualityError('Another decision was recorded; refresh before deciding', 'CALL_QUALITY_DECISION_CONFLICT', 409);
      if (!detail.permissions.canDecide) throw new CallQualityError('A separate approver who did not review this evidence is required', 'CALL_QUALITY_APPROVER_CONFLICT', 409);
      if (input.action === 'APPROVE_SAMPLE' && !detail.approvalReady) throw new CallQualityError('Two all-PASS independent reviews and complete verified sources are required', 'CALL_QUALITY_APPROVAL_BLOCKED', 409);
      await client.query(`
        INSERT INTO call_quality_decisions (execution_id, campaign_id, iteration_id, run_id, actor_user_id,
          evidence_fingerprint, revision, action, reason, attested)
        VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6,$7,$8,$9,TRUE)
      `, [executionId, source.campaign_id, source.iteration_id, source.run_id, actor.id,
        detail.evidenceFingerprint, detail.decisionRevision + 1, input.action, input.reason]);
    }
    const { detail: saved } = await loadDetail(client, actor, executionId, dependencies);
    // Detect source/rule byte changes that occurred while recording this audit.
    if (saved.evidenceFingerprint !== detail.evidenceFingerprint) throw new CallQualityError('Evidence changed during review; no attestation was saved', 'CALL_QUALITY_EVIDENCE_CONFLICT', 409);
    if (kind === 'decision' && input.action === 'APPROVE_SAMPLE' && !saved.approvalReady) {
      throw new CallQualityError('Reviewer eligibility changed; approval was not recorded', 'CALL_QUALITY_APPROVAL_BLOCKED', 409);
    }
    await client.query('COMMIT');
    return saved;
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') throw new CallQualityError('Another review or decision was recorded; refresh', 'CALL_QUALITY_WRITE_CONFLICT', 409);
    throw error;
  } finally { client.release(); }
}
export const saveCallQualityReview = (db, actor, executionId, body, dependencies = {}) => mutate(db, actor, executionId, body, 'review', dependencies);
export const saveCallQualityDecision = (db, actor, executionId, body, dependencies = {}) => mutate(db, actor, executionId, body, 'decision', dependencies);

export async function getCampaignCallQuality(db, actor, campaignId, selection = {}, dependencies = {}) {
  authorize(actor, ['SUPER_ADMIN', 'ADMIN', 'CAMPAIGN_MANAGER']); campaignId = validId(campaignId); actor = { ...actor, id: validId(actor.id) };
  if (Object.keys(selection).some((key) => key !== 'iterationId')) throw new CallQualityError('Call-quality summary is Iteration-wide; filters and Run narrowing are unsupported');
  if (selection.iterationId) selection = { iterationId: validId(selection.iterationId) };
  // Existing analysis authorization resolves the selected insight Iteration;
  // this summary never accepts a copied scope from the browser.
  const analysis = dependencies.analyze ? await dependencies.analyze(campaignId, actor, selection)
    : await (dependencies.resolveScope || resolveResearchScope)(db, campaignId, actor, selection);
  const iterationId = analysis.scope?.insightScope?.iterationId || null;
  if (analysis.campaign?.id !== campaignId || (iterationId && analysis.scope?.iteration?.id !== iterationId)
    || (!iterationId && analysis.scope?.iteration?.id) || (selection.iterationId && iterationId !== selection.iterationId)) {
    throw new CallQualityError('Authorized research scope is inconsistent', 'CALL_QUALITY_SCOPE_CONFLICT', 409);
  }
  if (!iterationId) return unavailableSummary(campaignId, null);
  const client = await db.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await verifyActiveActor(client, actor);
    const visibility = campaignReviewVisibilitySql(actor, 'campaign', 3);
    const scope = await client.query(`
      SELECT iteration.id FROM campaigns campaign JOIN campaign_iteration_links link ON link.campaign_id = campaign.id
      JOIN program_iterations iteration ON iteration.id = link.iteration_id
      WHERE campaign.id = $1::uuid AND iteration.id = $2::uuid AND campaign.status <> 'ARCHIVED' AND ${visibility.sql}
        AND (SELECT COUNT(*) FROM campaign_iteration_links linked WHERE linked.iteration_id = iteration.id) = 1
    `, [campaignId, iterationId, ...visibility.values]);
    if (scope.rows.length !== 1) throw new CallQualityError('Campaign or Iteration was not found', 'CALL_QUALITY_NOT_FOUND', 404);
    const schema = await client.query("SELECT to_regclass('public.call_quality_reviews') AS reviews_table, to_regclass('public.call_quality_decisions') AS decisions_table");
    if (!schema.rows[0]?.reviews_table || !schema.rows[0]?.decisions_table) {
      await client.query('COMMIT');
      return unavailableSummary(campaignId, iterationId);
    }
    const source = await client.query(`
      SELECT ${sourceProjection} ${sourceJoins}
      WHERE campaign.id = $1::uuid AND iteration.id = $2::uuid AND campaign.status <> 'ARCHIVED'
      ORDER BY execution.id
    `, [campaignId, iterationId]);
    const audit = await auditRows(client, campaignId, iterationId);
    const result = buildReviewSummary(campaignId, iterationId, source.rows, audit.reviews, audit.decisions,
      (dependencies.normalizationRulesHash || normalizationRulesHash)());
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    // Only the explicit missing-audit-table preflight above is a compatibility
    // absence. Arbitrary source, authorization and database errors propagate.
    throw error;
  } finally { client.release(); }
}
