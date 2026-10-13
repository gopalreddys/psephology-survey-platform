import { getDb } from '../db/postgres.js';
import { resolveResearchScope } from './research-scope.repository.js';
import { buildResearchReport, resolveFrozenReportDefinitions } from './research-report.js';
import { summarizeOutput, canonicalOutputKeySql } from './output-normalization.repository.js';
import { REPORT_CATALOG } from './report-catalog.js';
import { loadFieldworkDiagnostics } from './fieldwork-diagnostics.repository.js';
import { unavailableFieldworkDiagnostics } from './fieldwork-diagnostics.js';

// Exposed dependency seam supports isolated tests without contacting AWS/RDS.
// Authorization and scope resolution always precede metadata/database loading.
export async function loadResearchReport(campaignId, actor, selection = {}, dependencies = {}) {
  const database = dependencies.getDb || getDb;
  const diagnose = dependencies.loadFieldworkDiagnostics || loadFieldworkDiagnostics;
  if (!dependencies.analyze) {
    const client = await (await database()).connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const resolved = await (dependencies.resolveScope || resolveResearchScope)(client, campaignId, actor, selection);
      const report = await loadResearchReport(campaignId, actor, selection, { ...dependencies,
        analyze: async () => resolved, getDb: async () => client });
      await client.query('COMMIT'); return report;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  // The injected analysis seam is for isolated fixtures only; production uses
  // the bounded hierarchy resolver instead of rerunning strategic analytics.
  const analysis = await dependencies.analyze(campaignId, actor, selection);
  const iterationId = analysis.scope?.insightScope?.iterationId;
  if (analysis.campaign?.id !== campaignId || (!iterationId && analysis.scope?.iteration?.id)) {
    const error = new Error('Authorized research scope is inconsistent');
    error.statusCode = 409;
    throw error;
  }
  if (!iterationId) return buildResearchReport({ analysis,
    fieldworkDiagnostics: unavailableFieldworkDiagnostics('NO_SELECTED_ITERATION') });
  if (analysis.scope?.iteration?.id !== iterationId) {
    const error = new Error('Authorized research scope is inconsistent');
    error.statusCode = 409;
    throw error;
  }
  const db = await database();
  const filters = analysis.scope.insightScope.filters || {};
  // Only the already-authorized Campaign + selected insight Iteration is read.
  // No current questionnaire catalogue, raw response, transcript or user row is
  // returned. A Run restriction would incorrectly truncate Iteration insights.
  const source = await db.query(`
    SELECT iteration.questionnaire_id, iteration.questionnaire_snapshot, iteration.voice_agent_snapshot,
      evidence.latest_evidence_at
    FROM campaign_iteration_links link
    JOIN campaigns campaign ON campaign.id = link.campaign_id
    JOIN program_iterations iteration ON iteration.id = link.iteration_id
    LEFT JOIN LATERAL (
      SELECT MAX(COALESCE(call_record.updated_at, call_record.first_seen_at)) AS latest_evidence_at
      FROM calls call_record
      LEFT JOIN voter_master voter ON voter.id = call_record.voter_id
      WHERE call_record.iteration_id = iteration.id
        AND LOWER(COALESCE(call_record.connectivity_status, '')) = 'connected'
        AND call_record.voter_id IS NOT NULL
        AND jsonb_typeof(call_record.response_variables) = 'object'
        AND call_record.response_variables <> '{}'::jsonb
        AND ($3::text IS NULL OR CASE
          WHEN LOWER(TRIM(COALESCE(voter.gender, ''))) IN ('f', 'female', 'woman') THEN 'Female'
          WHEN LOWER(TRIM(COALESCE(voter.gender, ''))) IN ('m', 'male', 'man') THEN 'Male'
          WHEN TRIM(COALESCE(voter.gender, '')) = '' THEN 'Unknown'
          ELSE 'Other / self-described' END = $3)
        AND ($4::text IS NULL OR CASE
          WHEN voter.age >= 18 AND voter.age < 30 THEN '18–29'
          WHEN voter.age >= 30 AND voter.age < 40 THEN '30–39'
          WHEN voter.age >= 40 AND voter.age < 50 THEN '40–49'
          WHEN voter.age >= 50 THEN '50+' ELSE 'Unknown' END = $4)
        AND ($5::text IS NULL OR COALESCE(NULLIF(TRIM(voter.mandal_name_source), ''), 'Unknown') = $5)
    ) evidence ON TRUE
    WHERE campaign.id = $1::uuid AND iteration.id = $2::uuid
      AND campaign.status <> 'ARCHIVED'
  `, [campaignId, iterationId, filters.gender || null, filters.ageBand || null, filters.mandal || null]);
  if (source.rows.length !== 1) {
    const error = new Error('Selected research source is unavailable; refresh Campaign analysis');
    error.statusCode = 409;
    throw error;
  }
  const frozen = resolveFrozenReportDefinitions(source.rows[0].questionnaire_snapshot, source.rows[0].questionnaire_id);
  const supported = REPORT_CATALOG.filter((report) => report.measureKeys.length
    && frozen.definitions.get(report.id)?.status === 'CONTRACT_RECORDED');
  const exactMeasures = {};
  let latestEvidenceAt = source.rows[0].latest_evidence_at;
  if (supported.length && !analysis.segment?.suppressed) {
    const keys = [...new Set(supported.flatMap((report) => frozen.definitions.get(report.id).keys))];
    // Deduplicate before projecting report keys: a later nonempty record that
    // does not answer this construct remains missing, rather than reviving an
    // older answer. ORDER BY matches latestStructuredRespondents exactly.
    const selected = await db.query(`
      WITH authorized_rows AS (
        SELECT DISTINCT ON (call_record.voter_id) call_record.response_variables,
          COALESCE(call_record.updated_at, call_record.first_seen_at) AS evidence_at
        FROM campaign_iteration_links link
        JOIN campaigns campaign ON campaign.id = link.campaign_id
        JOIN program_iterations iteration ON iteration.id = link.iteration_id
        JOIN calls call_record ON call_record.iteration_id = iteration.id
        LEFT JOIN voter_master voter ON voter.id = call_record.voter_id
        WHERE campaign.id = $1::uuid AND iteration.id = $2::uuid
          AND campaign.status <> 'ARCHIVED'
          AND LOWER(COALESCE(call_record.connectivity_status, '')) = 'connected'
          AND call_record.voter_id IS NOT NULL
          AND jsonb_typeof(call_record.response_variables) = 'object'
          AND call_record.response_variables <> '{}'::jsonb
          AND ($3::text IS NULL OR CASE
            WHEN LOWER(TRIM(COALESCE(voter.gender, ''))) IN ('f', 'female', 'woman') THEN 'Female'
            WHEN LOWER(TRIM(COALESCE(voter.gender, ''))) IN ('m', 'male', 'man') THEN 'Male'
            WHEN TRIM(COALESCE(voter.gender, '')) = '' THEN 'Unknown'
            ELSE 'Other / self-described' END = $3)
          AND ($4::text IS NULL OR CASE
            WHEN voter.age >= 18 AND voter.age < 30 THEN '18–29'
            WHEN voter.age >= 30 AND voter.age < 40 THEN '30–39'
            WHEN voter.age >= 40 AND voter.age < 50 THEN '40–49'
            WHEN voter.age >= 50 THEN '50+' ELSE 'Unknown' END = $4)
          AND ($5::text IS NULL OR COALESCE(NULLIF(TRIM(voter.mandal_name_source), ''), 'Unknown') = $5)
        ORDER BY call_record.voter_id,
          COALESCE(call_record.updated_at, call_record.first_seen_at) DESC NULLS LAST,
          call_record.first_seen_at DESC NULLS LAST, call_record.id DESC
      )
      SELECT COALESCE((
        SELECT jsonb_object_agg(output.key, output.value)
        FROM jsonb_each(selected.response_variables) output
        WHERE ${canonicalOutputKeySql('output.key')} = ANY($6::text[])
      ), '{}'::jsonb) AS response_variables,
        MAX(selected.evidence_at) OVER () AS latest_evidence_at
      FROM authorized_rows selected
    `, [campaignId, iterationId, filters.gender || null, filters.ageBand || null, filters.mandal || null, keys]);
    // Freshness comes from the same SQL snapshot that supplied exact outputs,
    // not an earlier metadata query or the report generation timestamp.
    latestEvidenceAt = selected.rows[0]?.latest_evidence_at || null;
    for (const report of supported) {
      const outputVariables = frozen.definitions.get(report.id).keys;
      exactMeasures[report.id] = { source: 'FROZEN_CONTRACT_EXACT_KEYS', outputVariables,
        measure: summarizeOutput(selected.rows, outputVariables) };
    }
  }
  let design = null;
  try {
    const declared = await db.query(`
      SELECT registry.design_declared, registry.revision, registry.declared_at,
        registry.fieldwork_mode, registry.sampling_method, registry.cohort_design,
        registry.weighting_status, registry.comparison_status
      FROM analytics_research_design_registry_v2 registry
      JOIN campaign_iteration_links link ON link.iteration_id = registry.iteration_id
      WHERE registry.campaign_id = $1::uuid AND registry.iteration_id = $2::uuid
        AND link.campaign_id = $1::uuid
    `, [campaignId, iterationId]);
    design = declared.rows[0] || null;
  } catch (error) {
    // Old deployments remain honest: absence is not a complete declaration.
    if (!['42P01', '42703'].includes(error.code)) throw error;
  }
  let fieldworkDiagnostics;
  try {
    fieldworkDiagnostics = await diagnose(db, { campaignId, iterationId, filters,
      iterationCompleted: analysis.scope.iteration.completed === true,
      analysisRespondentBase: analysis.segment?.respondentBase ?? null });
  } catch (error) {
    // Compatibility absence is distinct from an unavailable database or an
    // authorization failure. Never mask operational failures as an empty cohort.
    if (!['42P01', '42703'].includes(error.code)) throw error;
    fieldworkDiagnostics = unavailableFieldworkDiagnostics('SOURCE_SCHEMA_UNAVAILABLE', { campaignId, iterationId, filters });
  }
  return buildResearchReport({ analysis, snapshot: source.rows[0].questionnaire_snapshot,
    questionnaireId: source.rows[0].questionnaire_id, exactMeasures,
    agentSnapshot: source.rows[0].voice_agent_snapshot, design,
    latestEvidenceAt, fieldworkDiagnostics });
}

export async function getCampaignResearchReport(campaignId, actor, selection = {}) {
  return loadResearchReport(campaignId, actor, selection);
}
