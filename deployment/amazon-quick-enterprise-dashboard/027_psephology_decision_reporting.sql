BEGIN;

CREATE OR REPLACE VIEW analytics_research_quality_v1 AS
WITH campaign_scope AS (
  SELECT
    campaign.id AS campaign_id,
    campaign.campaign_code,
    campaign.campaign_name,
    campaign.status AS campaign_status,
    program.id AS program_id,
    program.study_code AS program_code,
    program.study_name AS program_name
  FROM campaigns campaign
  LEFT JOIN survey_studies program ON program.id = campaign.program_id
  WHERE campaign.status <> 'ARCHIVED'
), iteration_stats AS (
  SELECT
    link.campaign_id,
    COUNT(DISTINCT link.iteration_id)::integer AS iteration_count
  FROM campaign_iteration_links link
  GROUP BY link.campaign_id
), execution_stats AS (
  SELECT
    link.campaign_id,
    COUNT(execution.id)::integer AS call_attempts,
    COUNT(execution.id) FILTER (
      WHERE execution.callback_received_at IS NOT NULL
    )::integer AS callbacks_received
  FROM campaign_iteration_links link
  JOIN campaign_runs run ON run.iteration_id = link.iteration_id
  LEFT JOIN call_executions execution ON execution.run_id = run.id
  GROUP BY link.campaign_id
), evidence_stats AS (
  SELECT
    link.campaign_id,
    COUNT(call_record.id) FILTER (
      WHERE LOWER(COALESCE(call_record.connectivity_status, '')) = 'connected'
    )::integer AS connected_calls,
    COUNT(call_record.id) FILTER (
      WHERE LOWER(COALESCE(call_record.connectivity_status, '')) = 'connected'
        AND jsonb_typeof(call_record.interaction_transcript) = 'array'
        AND jsonb_array_length(call_record.interaction_transcript) > 0
    )::integer AS transcripts_captured,
    COUNT(call_record.id) FILTER (
      WHERE LOWER(COALESCE(call_record.connectivity_status, '')) = 'connected'
        AND jsonb_typeof(call_record.response_variables) = 'object'
        AND call_record.response_variables <> '{}'::jsonb
    )::integer AS responses_captured,
    ROUND(AVG(call_record.duration_seconds) FILTER (
      WHERE LOWER(COALESCE(call_record.connectivity_status, '')) = 'connected'
    )::numeric, 1) AS average_duration_seconds,
    MIN(call_record.updated_at) FILTER (
      WHERE LOWER(COALESCE(call_record.connectivity_status, '')) = 'connected'
    ) AS fieldwork_started_at,
    MAX(call_record.updated_at) FILTER (
      WHERE LOWER(COALESCE(call_record.connectivity_status, '')) = 'connected'
    ) AS fieldwork_ended_at
  FROM campaign_iteration_links link
  LEFT JOIN calls call_record ON call_record.iteration_id = link.iteration_id
  GROUP BY link.campaign_id
), research_stats AS (
  SELECT
    research.campaign_id,
    COUNT(DISTINCT research.respondent_key)::integer AS respondent_base,
    COUNT(DISTINCT research.respondent_key) FILTER (
      WHERE research.gender <> 'Unknown'
    )::integer AS known_gender_respondents,
    COUNT(DISTINCT research.respondent_key) FILTER (
      WHERE research.age_band <> 'Unknown'
    )::integer AS known_age_respondents,
    COUNT(DISTINCT research.respondent_key) FILTER (
      WHERE research.mandal_name <> 'Unknown'
    )::integer AS known_mandal_respondents,
    COUNT(DISTINCT research.respondent_key) FILTER (
      WHERE research.direct_party_strength IS NOT NULL
    )::integer AS direct_measure_respondents
  FROM analytics_research_enterprise_v1 research
  GROUP BY research.campaign_id
), combined AS (
  SELECT
    campaign.*,
    COALESCE(iteration.iteration_count, 0)::integer AS iteration_count,
    COALESCE(execution.call_attempts, 0)::integer AS call_attempts,
    COALESCE(execution.callbacks_received, 0)::integer AS callbacks_received,
    COALESCE(evidence.connected_calls, 0)::integer AS connected_calls,
    COALESCE(evidence.transcripts_captured, 0)::integer AS transcripts_captured,
    COALESCE(evidence.responses_captured, 0)::integer AS responses_captured,
    COALESCE(evidence.average_duration_seconds, 0)::numeric AS average_duration_seconds,
    evidence.fieldwork_started_at,
    evidence.fieldwork_ended_at,
    COALESCE(research.respondent_base, 0)::integer AS respondent_base,
    COALESCE(research.known_gender_respondents, 0)::integer AS known_gender_respondents,
    COALESCE(research.known_age_respondents, 0)::integer AS known_age_respondents,
    COALESCE(research.known_mandal_respondents, 0)::integer AS known_mandal_respondents,
    COALESCE(research.direct_measure_respondents, 0)::integer AS direct_measure_respondents
  FROM campaign_scope campaign
  LEFT JOIN iteration_stats iteration ON iteration.campaign_id = campaign.campaign_id
  LEFT JOIN execution_stats execution ON execution.campaign_id = campaign.campaign_id
  LEFT JOIN evidence_stats evidence ON evidence.campaign_id = campaign.campaign_id
  LEFT JOIN research_stats research ON research.campaign_id = campaign.campaign_id
)
SELECT
  combined.*,
  CASE WHEN call_attempts = 0 THEN 0
    ELSE ROUND((callbacks_received::numeric / call_attempts) * 100, 1)
  END AS callback_coverage_pct,
  CASE WHEN call_attempts = 0 THEN 0
    ELSE ROUND((connected_calls::numeric / call_attempts) * 100, 1)
  END AS connection_rate_pct,
  CASE WHEN connected_calls = 0 THEN 0
    ELSE ROUND((transcripts_captured::numeric / connected_calls) * 100, 1)
  END AS transcript_coverage_pct,
  CASE WHEN connected_calls = 0 THEN 0
    ELSE ROUND((responses_captured::numeric / connected_calls) * 100, 1)
  END AS response_coverage_pct,
  CASE WHEN respondent_base = 0 THEN 0
    ELSE ROUND(((known_gender_respondents + known_age_respondents +
      known_mandal_respondents)::numeric / (respondent_base * 3)) * 100, 1)
  END AS demographic_completeness_pct,
  CASE WHEN respondent_base = 0 THEN 0
    ELSE ROUND((direct_measure_respondents::numeric / respondent_base) * 100, 1)
  END AS direct_measure_coverage_pct,
  'DIRECTIONAL_NON_PROBABILITY'::text AS sampling_design,
  'NOT_CONFIGURED'::text AS weighting_status,
  CASE
    WHEN respondent_base >= 30
      AND connected_calls > 0
      AND (responses_captured::numeric / NULLIF(connected_calls, 0)) >= 0.80
      AND ((known_gender_respondents + known_age_respondents +
        known_mandal_respondents)::numeric / NULLIF(respondent_base * 3, 0)) >= 0.80
      THEN 'EVIDENCE_READY'
    WHEN respondent_base >= 5
      AND connected_calls > 0
      AND (responses_captured::numeric / NULLIF(connected_calls, 0)) >= 0.50
      THEN 'DIRECTIONAL'
    ELSE 'LIMITED'
  END AS evidence_quality_status,
  'Operational evidence quality; not statistical confidence or vote-share precision'::text
    AS interpretation_label
FROM combined;

COMMENT ON VIEW analytics_research_quality_v1 IS
  'Aggregate campaign fieldwork, evidence coverage and demographic completeness. Quality status does not represent sampling confidence or vote-share precision.';

-- Bootstrap only. Never overwrite the newer guarded view during migration replay.
DO $bootstrap$
BEGIN
  IF to_regclass('analytics_iteration_movement_v1') IS NULL THEN
    EXECUTE $movement_view$
CREATE VIEW analytics_iteration_movement_v1 AS
WITH iteration_signal AS (
  SELECT
    research.program_id,
    research.program_code,
    research.program_name,
    research.campaign_id,
    research.campaign_code,
    research.campaign_name,
    research.iteration_id,
    research.iteration_number,
    research.iteration_name,
    COUNT(DISTINCT research.respondent_key)::integer AS respondent_base,
    ROUND(AVG(research.direct_party_strength), 2) AS average_direct_party_strength,
    COUNT(DISTINCT research.respondent_key) FILTER (
      WHERE research.direct_party_strength IS NOT NULL
    )::integer AS direct_measure_base,
    ROUND(100.0 * COUNT(DISTINCT research.respondent_key) FILTER (
      WHERE research.respondent_sentiment = 'Positive'
    ) / NULLIF(COUNT(DISTINCT research.respondent_key), 0), 1) AS positive_sentiment_pct,
    ROUND(100.0 * COUNT(DISTINCT research.respondent_key) FILTER (
      WHERE research.respondent_sentiment = 'Negative'
    ) / NULLIF(COUNT(DISTINCT research.respondent_key), 0), 1) AS negative_sentiment_pct,
    ROUND(100.0 * COUNT(DISTINCT research.respondent_key) FILTER (
      WHERE research.candidate_sentiment = 'Positive'
    ) / NULLIF(COUNT(DISTINCT research.respondent_key), 0), 1) AS candidate_positive_pct,
    COUNT(DISTINCT research.respondent_key) FILTER (
      WHERE research.issue_priority IS NOT NULL
    )::integer AS issue_response_base
  FROM analytics_research_enterprise_v1 research
  GROUP BY
    research.program_id,
    research.program_code,
    research.program_name,
    research.campaign_id,
    research.campaign_code,
    research.campaign_name,
    research.iteration_id,
    research.iteration_number,
    research.iteration_name
)
SELECT
  signal.*,
  ROUND(signal.average_direct_party_strength - LAG(signal.average_direct_party_strength)
    OVER (PARTITION BY signal.campaign_id ORDER BY signal.iteration_number), 2)
    AS party_strength_change,
  ROUND(signal.positive_sentiment_pct - LAG(signal.positive_sentiment_pct)
    OVER (PARTITION BY signal.campaign_id ORDER BY signal.iteration_number), 1)
    AS positive_sentiment_change_pct,
  ROUND(signal.candidate_positive_pct - LAG(signal.candidate_positive_pct)
    OVER (PARTITION BY signal.campaign_id ORDER BY signal.iteration_number), 1)
    AS candidate_positive_change_pct,
  CASE
    WHEN LAG(signal.iteration_number) OVER (
      PARTITION BY signal.campaign_id ORDER BY signal.iteration_number
    ) IS NULL THEN 'BASELINE'
    ELSE 'CHANGE_FROM_PREVIOUS_ITERATION'
  END AS comparison_basis,
  'Comparable aggregate movement only; questionnaire and sample changes must be reviewed'::text
    AS interpretation_label
FROM iteration_signal signal;
$movement_view$;
  END IF;
END
$bootstrap$;

COMMENT ON VIEW analytics_iteration_movement_v1 IS
  'Aggregate Iteration signals and change from the previous Iteration; not a causal campaign-effect estimate.';

COMMIT;
