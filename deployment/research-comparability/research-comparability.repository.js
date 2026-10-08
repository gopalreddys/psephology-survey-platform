// Metadata only: callers must authorize the Iterations before loading this gate.
// SQL is the single authority for questionnaire and declared-method comparability.
export async function loadIterationComparability(db, iterationIds) {
  const ids = [...new Set(iterationIds.filter(Boolean))];
  if (!ids.length) return new Map();
  try {
    const { rows } = await db.query(`
      SELECT iteration_id, campaign_id, iteration_number, previous_iteration_id,
             comparison_status, comparison_reasons, design_declared
      FROM analytics_iteration_comparability_v1
      WHERE iteration_id = ANY($1::uuid[])
    `, [ids]);
    return new Map(rows.map((row) => [row.iteration_id, {
      iterationId: row.iteration_id,
      campaignId: row.campaign_id,
      iterationNumber: Number(row.iteration_number),
      previousIterationId: row.previous_iteration_id,
      status: row.comparison_status,
      reasons: row.comparison_reasons || [],
      designDeclared: row.design_declared === true
    }]));
  } catch (error) {
    // Do not fall back to questionnaire IDs or shared response keys on old schemas.
    if (!['42P01', '42703'].includes(error.code)) throw error;
    return new Map(ids.map((id) => [id, {
      iterationId: id,
      campaignId: null,
      iterationNumber: null,
      previousIterationId: null,
      status: 'NOT_COMPARABLE',
      reasons: ['Research comparison gate unavailable; apply migration 029 before comparing Iterations.'],
      designDeclared: false
    }]));
  }
}

export function evaluateIterationComparison(previousId, latestId, comparability) {
  const previous = comparability.get(previousId);
  const latest = comparability.get(latestId);
  const reasons = [];
  if (!previousId || !latestId || previousId === latestId) {
    reasons.push('Two distinct consecutive Iterations are required.');
  }
  if (!previous || !latest) {
    reasons.push('Research comparison metadata is unavailable for one or both Iterations.');
  } else {
    if (!previous.campaignId || previous.campaignId !== latest.campaignId) {
      reasons.push('Both Iterations must belong to the same Campaign.');
    }
    if (latest.previousIterationId !== previousId ||
        latest.iterationNumber !== previous.iterationNumber + 1) {
      reasons.push('Only consecutive Campaign Iterations can be compared; do not bridge missing waves.');
    }
    if (!previous.designDeclared || !latest.designDeclared) {
      reasons.push('Research design must be declared for both Iterations.');
    }
    if (latest.status !== 'COMPARABLE') {
      reasons.push(...latest.reasons);
      if (!latest.reasons.length) reasons.push('The shared research comparison gate has not passed.');
    }
  }
  return {
    status: reasons.length ? 'NOT_COMPARABLE' : 'COMPARABLE',
    reasons: [...new Set(reasons)],
    previousIterationId: previousId || null,
    latestIterationId: latestId || null
  };
}
