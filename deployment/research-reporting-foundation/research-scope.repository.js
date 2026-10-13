import { campaignReviewVisibilitySql } from './campaign-visibility.repository.js';
import { NORMALIZATION_VERSION, getSentimentValidation, SENTIMENT_CONSTRUCTS } from './output-normalization.repository.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail = (message, statusCode) => Object.assign(new Error(message), { statusCode });
const id = (value, label) => { if (typeof value !== 'string' || !UUID.test(value)) throw fail(`Invalid ${label}`, 400); return value; };

// Resolve only authorized hierarchy and an aggregate base. Never load all
// Campaign transcripts, output rows, comparisons or strategic recommendations.
// Callers with repeatable-read transactions pass that same transaction client.
export async function resolveResearchScope(db, campaignId, actor, selection = {}) {
  if (!actor || !['SUPER_ADMIN', 'ADMIN', 'CAMPAIGN_MANAGER'].includes(actor.role_code)) throw fail('Research access is unavailable', 403);
  campaignId = id(campaignId, 'Campaign'); id(actor.id, 'account');
  if (!selection || typeof selection !== 'object' || Array.isArray(selection)
    || Object.keys(selection).some((key) => !['iterationId', 'runId', 'gender', 'ageBand', 'mandal', 'sentimentConstruct'].includes(key))) throw fail('Invalid research scope', 400);
  const iterationId = selection.iterationId ? id(selection.iterationId, 'Iteration') : null;
  const runId = selection.runId ? id(selection.runId, 'Run') : null;
  if (runId && !iterationId) throw fail("Select the Run's Iteration explicitly", 400);
  if (selection.gender && !['Female', 'Male', 'Other / self-described', 'Unknown'].includes(selection.gender)) throw fail('Invalid gender filter', 400);
  if (selection.ageBand && !['18–29', '30–39', '40–49', '50+'].includes(selection.ageBand)) throw fail('Invalid age filter', 400);
  if (selection.mandal && (typeof selection.mandal !== 'string' || selection.mandal.length > 160)) throw fail('Invalid Mandal filter', 400);
  if (selection.sentimentConstruct && !SENTIMENT_CONSTRUCTS.some((item) => item.key === selection.sentimentConstruct && item.type === 'SENTIMENT')) throw fail('Invalid sentiment construct', 400);
  const account = await db.query(`SELECT account.id FROM users account JOIN roles role ON role.id=account.role_id
    WHERE account.id=$1::uuid AND account.status='ACTIVE' AND role.is_active=TRUE AND role.code=$2`, [actor.id, actor.role_code]);
  if (account.rows.length !== 1) throw fail('An active authorized account is required', 403);
  const visibility = campaignReviewVisibilitySql(actor, 'campaign', 2);
  const campaign = await db.query(`SELECT campaign.id, campaign.campaign_code AS code, campaign.campaign_name AS name, campaign.status
    FROM campaigns campaign WHERE campaign.id=$1::uuid AND campaign.status <> 'ARCHIVED' AND ${visibility.sql}`, [campaignId, ...visibility.values]);
  if (campaign.rows.length !== 1) throw fail('Campaign was not found', 404);
  const iterations = await db.query(`SELECT iteration.id, iteration.iteration_number AS number, iteration.iteration_name AS name,
      COALESCE(link.status, iteration.status) AS status,
      COALESCE(link.status, iteration.status) IN ('COMPLETED','LOCKED') AS completed
    FROM program_iterations iteration JOIN campaign_iteration_links link ON link.iteration_id=iteration.id
    WHERE link.campaign_id=$1::uuid AND ($2::uuid IS NULL OR iteration.id=$2::uuid)
      AND (SELECT COUNT(*) FROM campaign_iteration_links other WHERE other.iteration_id=iteration.id)=1
    ORDER BY iteration.iteration_number, iteration.id`, [campaignId, iterationId]);
  const iteration = iterationId ? iterations.rows[0] : iterations.rows.filter((row) => row.completed).at(-1);
  if (iterationId && !iteration) throw fail('Iteration is not part of this Campaign or its source is ambiguous', 404);
  let run = null;
  if (runId) {
    const runs = await db.query('SELECT id, run_number AS number, status FROM campaign_runs WHERE id=$1::uuid AND iteration_id=$2::uuid', [runId, iteration.id]);
    if (runs.rows.length !== 1) throw fail('Run is not part of the selected Iteration', 404);
    run = runs.rows[0];
  }
  const filters = { gender: selection.gender || null, ageBand: selection.ageBand || null, mandal: selection.mandal || null };
  let respondentBase = 0;
  if (iteration) {
    const base = await db.query(`SELECT COUNT(DISTINCT call_record.voter_id)::int AS respondent_base
      FROM calls call_record LEFT JOIN voter_master voter ON voter.id=call_record.voter_id
      WHERE call_record.iteration_id=$1::uuid AND call_record.voter_id IS NOT NULL
        AND LOWER(COALESCE(call_record.connectivity_status,''))='connected'
        AND jsonb_typeof(call_record.response_variables)='object' AND call_record.response_variables <> '{}'::jsonb
        AND ($2::text IS NULL OR CASE WHEN LOWER(TRIM(COALESCE(voter.gender,''))) IN ('f','female','woman') THEN 'Female'
          WHEN LOWER(TRIM(COALESCE(voter.gender,''))) IN ('m','male','man') THEN 'Male'
          WHEN TRIM(COALESCE(voter.gender,''))='' THEN 'Unknown' ELSE 'Other / self-described' END=$2)
        AND ($3::text IS NULL OR CASE WHEN voter.age >=18 AND voter.age <30 THEN '18–29' WHEN voter.age >=30 AND voter.age <40 THEN '30–39'
          WHEN voter.age >=40 AND voter.age <50 THEN '40–49' WHEN voter.age >=50 THEN '50+' ELSE 'Unknown' END=$3)
        AND ($4::text IS NULL OR COALESCE(NULLIF(TRIM(voter.mandal_name_source),''),'Unknown')=$4)`, [iteration.id, filters.gender, filters.ageBand, filters.mandal]);
    respondentBase = Number(base.rows[0]?.respondent_base || 0);
  }
  return { campaign: campaign.rows[0], generatedAt: new Date().toISOString(),
    scope: { level: run ? 'RUN' : iterationId ? 'ITERATION' : 'CAMPAIGN', iteration: iteration || null, run,
      insightScope: { iterationId: iteration?.id || null, filters } },
    segment: { respondentBase, suppressed: Boolean(iteration) && respondentBase < 5 },
    normalizationVersion: NORMALIZATION_VERSION, sentimentValidation: getSentimentValidation(),
    demographicProvenance: 'CURRENT_MASTER_DATA' };
}
