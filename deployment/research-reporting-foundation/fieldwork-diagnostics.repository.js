import { buildFieldworkDiagnostics, unavailableFieldworkDiagnostics } from './fieldwork-diagnostics.js';

// The caller must already authorize the Campaign and resolve its exact insight
// Iteration. This read also enforces the Campaign/Iteration link. It intentionally
// has no Run filter and never selects raw response variables or voter identities.
export async function loadFieldworkDiagnostics(db, { campaignId, iterationId, filters = {},
  iterationCompleted = false, analysisRespondentBase = null } = {}) {
  if (!iterationId) return unavailableFieldworkDiagnostics('NO_SELECTED_ITERATION');
  const selectedScope = { campaignId, iterationId, filters: { gender: filters.gender || null,
    ageBand: filters.ageBand || null, mandal: filters.mandal || null } };
  let result;
  try {
    result = await db.query(`
      WITH scope AS (
        SELECT DISTINCT iteration.id AS iteration_id
        FROM campaign_iteration_links link
        JOIN campaigns campaign ON campaign.id = link.campaign_id
        JOIN program_iterations iteration ON iteration.id = link.iteration_id
        WHERE campaign.id = $1::uuid AND iteration.id = $2::uuid
          AND campaign.status <> 'ARCHIVED'
      ), initial_runs AS (
        SELECT run.id FROM campaign_runs run JOIN scope ON scope.iteration_id = run.iteration_id
        WHERE run.run_number = 1
      ), initial_contacts AS (
        SELECT contact.voter_id FROM campaign_run_contacts contact
        JOIN initial_runs run ON run.id = contact.run_id
      ), cohort AS (
        SELECT DISTINCT contact.voter_id FROM initial_contacts contact WHERE contact.voter_id IS NOT NULL
      ), categorized_voters AS (
        SELECT selected.voter_id,
          CASE WHEN LOWER(TRIM(COALESCE(voter.gender, ''))) IN ('f', 'female', 'woman') THEN 'Female'
            WHEN LOWER(TRIM(COALESCE(voter.gender, ''))) IN ('m', 'male', 'man') THEN 'Male'
            WHEN TRIM(COALESCE(voter.gender, '')) = '' THEN 'Unknown' ELSE 'Other / self-described' END AS gender,
          CASE WHEN voter.age >= 18 AND voter.age < 30 THEN '18–29'
            WHEN voter.age >= 30 AND voter.age < 40 THEN '30–39'
            WHEN voter.age >= 40 AND voter.age < 50 THEN '40–49'
            WHEN voter.age >= 50 THEN '50+' ELSE 'Unknown' END AS age_band,
          COALESCE(NULLIF(TRIM(voter.mandal_name_source), ''), 'Unknown') AS mandal
        FROM cohort selected LEFT JOIN voter_master voter ON voter.id = selected.voter_id
      ), filtered_cohort AS (
        SELECT * FROM categorized_voters
        WHERE ($3::text IS NULL OR gender = $3) AND ($4::text IS NULL OR age_band = $4)
          AND ($5::text IS NULL OR mandal = $5)
      ), all_contacts AS (
        SELECT contact.id, contact.voter_id, contact.run_id, contact.attempt_status, contact.attempt_count,
          run.iteration_id, run.run_number
        FROM campaign_runs run JOIN scope ON scope.iteration_id = run.iteration_id
        JOIN campaign_run_contacts contact ON contact.run_id = run.id
      ), matched_executions AS (
        SELECT selected.voter_id, execution.id, execution.run_id, execution.status,
          execution.provider_attempt_id, execution.callback_received_at,
          execution.created_at, execution.updated_at
        FROM filtered_cohort selected JOIN all_contacts contact ON contact.voter_id = selected.voter_id
        JOIN call_executions execution ON execution.run_contact_id = contact.id
          AND execution.voter_id = contact.voter_id AND execution.run_id = contact.run_id
      ), matched_calls AS (
        SELECT execution.id AS execution_id, execution.voter_id,
          call_record.id AS call_id,
          LOWER(TRIM(COALESCE(call_record.connectivity_status, ''))) AS connectivity,
          (LOWER(TRIM(COALESCE(call_record.connectivity_status, ''))) = 'connected'
            AND jsonb_typeof(call_record.response_variables) = 'object'
            AND call_record.response_variables <> '{}'::jsonb) IS TRUE AS structured_record,
          COALESCE(call_record.updated_at, call_record.first_seen_at) AS evidence_at,
          call_record.first_seen_at
        FROM matched_executions execution JOIN calls call_record
          ON call_record.attempt_id = execution.provider_attempt_id
          AND call_record.iteration_id = $2::uuid AND call_record.voter_id = execution.voter_id
          AND call_record.run_id = execution.run_id
        WHERE NULLIF(TRIM(execution.provider_attempt_id::text), '') IS NOT NULL
      ), latest_execution AS (
        SELECT DISTINCT ON (execution.voter_id) execution.*
        FROM matched_executions execution
        ORDER BY execution.voter_id, COALESCE(execution.created_at, execution.updated_at) DESC NULLS LAST,
          execution.updated_at DESC NULLS LAST, execution.id DESC
      ), latest_execution_call AS (
        SELECT DISTINCT ON (call_record.execution_id) call_record.* FROM matched_calls call_record
        ORDER BY call_record.execution_id, call_record.evidence_at DESC NULLS LAST,
          call_record.first_seen_at DESC NULLS LAST, call_record.call_id DESC
      ), contact_observations AS (
        SELECT selected.*,
          EXISTS(SELECT 1 FROM matched_executions execution WHERE execution.voter_id = selected.voter_id) AS attempted,
          EXISTS(SELECT 1 FROM matched_calls call_record WHERE call_record.voter_id = selected.voter_id
            AND call_record.connectivity = 'connected') AS connected,
          EXISTS(SELECT 1 FROM matched_calls call_record WHERE call_record.voter_id = selected.voter_id
            AND call_record.structured_record) AS structured,
          CASE
            WHEN EXISTS(SELECT 1 FROM matched_calls call_record WHERE call_record.voter_id = selected.voter_id
              AND call_record.structured_record) THEN 'STRUCTURED_RECORD'
            WHEN latest.id IS NULL AND EXISTS(SELECT 1 FROM all_contacts contact WHERE contact.voter_id = selected.voter_id
              AND (COALESCE(contact.attempt_count, 0) > 0 OR COALESCE(contact.attempt_status, 'PENDING') <> 'PENDING')) THEN 'UNKNOWN'
            WHEN latest.id IS NULL THEN 'NOT_ATTEMPTED'
            WHEN UPPER(TRIM(COALESCE(latest.status, ''))) NOT IN ('COMPLETED', 'FAILED', 'CANCELLED', 'ARCHIVED') THEN 'PENDING'
            WHEN UPPER(TRIM(COALESCE(latest.status, ''))) = 'FAILED'
              AND NULLIF(TRIM(latest.provider_attempt_id::text), '') IS NULL
              AND latest.callback_received_at IS NULL THEN 'SUBMISSION_FAILED'
            WHEN latest.callback_received_at IS NULL OR latest_call.call_id IS NULL THEN 'CALLBACK_OR_RESULT_UNAVAILABLE'
            WHEN latest_call.connectivity = 'connected' THEN 'CONNECTED_NO_RECORD'
            WHEN latest_call.connectivity = 'busy' THEN 'BUSY'
            WHEN latest_call.connectivity = 'no_answer' THEN 'NO_ANSWER'
            WHEN latest_call.connectivity = 'failed' THEN 'PROVIDER_FAILED'
            ELSE 'UNKNOWN' END AS outcome
        FROM filtered_cohort selected LEFT JOIN latest_execution latest ON latest.voter_id = selected.voter_id
        LEFT JOIN latest_execution_call latest_call ON latest_call.execution_id = latest.id
      ), source_integrity AS (
        SELECT
          (SELECT COUNT(*)::int FROM matched_executions selected_execution
            WHERE NULLIF(TRIM(selected_execution.provider_attempt_id::text), '') IS NOT NULL AND (
              EXISTS(SELECT 1 FROM call_executions other_execution
                WHERE other_execution.provider_attempt_id = selected_execution.provider_attempt_id
                  AND other_execution.id <> selected_execution.id)
              OR EXISTS(SELECT 1 FROM calls other_call
                WHERE other_call.attempt_id = selected_execution.provider_attempt_id
                  AND (other_call.iteration_id IS DISTINCT FROM $2::uuid
                    OR other_call.voter_id IS DISTINCT FROM selected_execution.voter_id
                    OR other_call.run_id IS DISTINCT FROM selected_execution.run_id))))
          + (SELECT COUNT(*)::int FROM filtered_cohort selected JOIN all_contacts contact ON contact.voter_id = selected.voter_id
            JOIN call_executions execution ON execution.run_contact_id = contact.id
            WHERE execution.voter_id IS DISTINCT FROM contact.voter_id OR execution.run_id IS DISTINCT FROM contact.run_id)
            AS identity_conflicts,
          (SELECT COUNT(*)::int FROM matched_executions execution
            WHERE UPPER(TRIM(COALESCE(execution.status, ''))) NOT IN ('PENDING', 'SUBMITTED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'))
            AS status_conflicts
      ), outside_initial AS (
        SELECT DISTINCT contact.voter_id,
          CASE WHEN LOWER(TRIM(COALESCE(voter.gender, ''))) IN ('f', 'female', 'woman') THEN 'Female'
            WHEN LOWER(TRIM(COALESCE(voter.gender, ''))) IN ('m', 'male', 'man') THEN 'Male'
            WHEN TRIM(COALESCE(voter.gender, '')) = '' THEN 'Unknown' ELSE 'Other / self-described' END AS gender,
          CASE WHEN voter.age >= 18 AND voter.age < 30 THEN '18–29'
            WHEN voter.age >= 30 AND voter.age < 40 THEN '30–39'
            WHEN voter.age >= 40 AND voter.age < 50 THEN '40–49'
            WHEN voter.age >= 50 THEN '50+' ELSE 'Unknown' END AS age_band,
          COALESCE(NULLIF(TRIM(voter.mandal_name_source), ''), 'Unknown') AS mandal
        FROM all_contacts contact LEFT JOIN voter_master voter ON voter.id = contact.voter_id
        WHERE contact.voter_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM cohort selected WHERE selected.voter_id = contact.voter_id)
      )
      SELECT EXISTS(SELECT 1 FROM scope) AS scope_available,
        (SELECT MAX(stored_at) FROM (
          SELECT GREATEST(run.created_at, run.updated_at) AS stored_at FROM campaign_runs run
            JOIN scope ON scope.iteration_id = run.iteration_id
          UNION ALL SELECT GREATEST(execution.created_at, execution.updated_at, execution.callback_received_at)
            FROM matched_executions execution
          UNION ALL SELECT GREATEST(call_record.evidence_at, call_record.first_seen_at) FROM matched_calls call_record
        ) retained_events) AS observed_at,
        (SELECT identity_conflicts FROM source_integrity) AS source_identity_conflicts,
        (SELECT status_conflicts FROM source_integrity) AS source_status_conflicts,
        (SELECT COUNT(*)::int FROM initial_runs) AS initial_run_count,
        (SELECT COUNT(*)::int FROM initial_contacts) AS initial_contact_count,
        (SELECT COUNT(*)::int FROM initial_contacts WHERE voter_id IS NULL) AS initial_null_voter_count,
        COUNT(*)::int AS selected_base, COUNT(*) FILTER(WHERE attempted)::int AS attempted_base,
        COUNT(*) FILTER(WHERE connected)::int AS connected_base, COUNT(*) FILTER(WHERE structured)::int AS structured_base,
        (SELECT COUNT(*)::int FROM outside_initial WHERE ($3::text IS NULL OR gender = $3)
          AND ($4::text IS NULL OR age_band = $4) AND ($5::text IS NULL OR mandal = $5)) AS outside_initial_base,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('key', outcome, 'participants', participants))
          FROM (SELECT outcome, COUNT(*)::int AS participants FROM contact_observations GROUP BY outcome) grouped), '[]'::jsonb) AS outcomes,
        jsonb_build_object(
          'gender', COALESCE((SELECT jsonb_agg(jsonb_build_object('category', gender, 'selected', selected, 'structured', structured))
            FROM (SELECT gender, COUNT(*)::int AS selected, COUNT(*) FILTER(WHERE structured)::int AS structured
              FROM contact_observations GROUP BY gender) grouped), '[]'::jsonb),
          'ageBand', COALESCE((SELECT jsonb_agg(jsonb_build_object('category', age_band, 'selected', selected, 'structured', structured))
            FROM (SELECT age_band, COUNT(*)::int AS selected, COUNT(*) FILTER(WHERE structured)::int AS structured
              FROM contact_observations GROUP BY age_band) grouped), '[]'::jsonb),
          'mandal', COALESCE((SELECT jsonb_agg(jsonb_build_object('category', mandal, 'selected', selected, 'structured', structured))
            FROM (SELECT mandal, COUNT(*)::int AS selected, COUNT(*) FILTER(WHERE structured)::int AS structured
              FROM contact_observations GROUP BY mandal) grouped), '[]'::jsonb)) AS demographics
      FROM contact_observations
    `, [campaignId, iterationId, filters.gender || null, filters.ageBand || null, filters.mandal || null]);
  } catch (error) {
    if (['42P01', '42703'].includes(error.code)) return unavailableFieldworkDiagnostics('SOURCE_SCHEMA_UNAVAILABLE', selectedScope);
    throw error;
  }
  return buildFieldworkDiagnostics({ aggregate: result.rows[0], iterationCompleted, analysisRespondentBase, scope: selectedScope });
}
