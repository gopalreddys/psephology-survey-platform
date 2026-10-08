BEGIN;

-- Preserve the existing view columns; the preceding Iteration ID is appended.
-- This migration does not declare methodology or infer missing historical identity.
CREATE OR REPLACE VIEW analytics_iteration_comparability_v1 AS
WITH edges AS (
  SELECT iteration.id AS iteration_id,
    LAG(iteration.id) OVER campaign_order AS previous_iteration_id,
    LAG(iteration.iteration_number) OVER campaign_order AS previous_iteration_number,
    LAG(iteration.questionnaire_id) OVER campaign_order AS previous_questionnaire_id,
    (iteration.questionnaire_id IS NOT NULL
      AND jsonb_typeof(iteration.questionnaire_snapshot) = 'object'
      AND NULLIF(TRIM(iteration.questionnaire_snapshot->>'code'), '') IS NOT NULL
      AND NULLIF(TRIM(iteration.questionnaire_snapshot->>'version'), '') IS NOT NULL
      AND (iteration.questionnaire_snapshot->>'id' IS NULL
        OR iteration.questionnaire_snapshot->>'id' = iteration.questionnaire_id::text)
    ) IS TRUE AS instrument_recorded,
    LAG((iteration.questionnaire_id IS NOT NULL
      AND jsonb_typeof(iteration.questionnaire_snapshot) = 'object'
      AND NULLIF(TRIM(iteration.questionnaire_snapshot->>'code'), '') IS NOT NULL
      AND NULLIF(TRIM(iteration.questionnaire_snapshot->>'version'), '') IS NOT NULL
      AND (iteration.questionnaire_snapshot->>'id' IS NULL
        OR iteration.questionnaire_snapshot->>'id' = iteration.questionnaire_id::text)
    ) IS TRUE) OVER campaign_order AS previous_instrument_recorded,
    LAG(registry.weighting_variables) OVER campaign_order AS previous_weighting_variables,
    LAG(registry.selection_method) OVER campaign_order AS previous_selection_method
  FROM campaign_iteration_links link
  JOIN campaigns campaign ON campaign.id = link.campaign_id
  JOIN program_iterations iteration ON iteration.id = link.iteration_id
  LEFT JOIN analytics_research_design_registry registry ON registry.iteration_id = iteration.id
  WHERE campaign.status <> 'ARCHIVED'
  WINDOW campaign_order AS (
    PARTITION BY campaign.id ORDER BY iteration.iteration_number, iteration.created_at, iteration.id
  )
), design AS (
  SELECT
    campaign.id AS campaign_id,
    campaign.campaign_code,
    campaign.campaign_name,
    iteration.id AS iteration_id,
    iteration.iteration_number,
    iteration.iteration_name,
    iteration.questionnaire_id,
    MD5(COALESCE(
      NULLIF(iteration.questionnaire_snapshot::text, '{}'),
      iteration.questionnaire_id::text,
      'MISSING'
    )) AS questionnaire_fingerprint,
    registry.target_population,
    registry.sample_frame_name,
    registry.sampling_method,
    registry.selection_method,
    registry.weighting_status,
    registry.weighting_method,
    registry.weighting_variables,
    registry.fieldwork_mode,
    registry.methodology_notes,
    registry.declared_by_user_id,
    registry.declared_at,
    registry.updated_at,
    LAG(MD5(COALESCE(
      NULLIF(iteration.questionnaire_snapshot::text, '{}'),
      iteration.questionnaire_id::text,
      'MISSING'
    ))) OVER campaign_order AS previous_questionnaire_fingerprint,
    LAG(registry.target_population) OVER campaign_order AS previous_target_population,
    LAG(registry.sample_frame_name) OVER campaign_order AS previous_sample_frame_name,
    LAG(registry.sampling_method) OVER campaign_order AS previous_sampling_method,
    LAG(registry.weighting_status) OVER campaign_order AS previous_weighting_status,
    LAG(COALESCE(registry.weighting_method, '')) OVER campaign_order AS previous_weighting_method,
    LAG(registry.fieldwork_mode) OVER campaign_order AS previous_fieldwork_mode,
    LAG(registry.declared_at) OVER campaign_order AS previous_declared_at
  FROM campaign_iteration_links link
  JOIN campaigns campaign ON campaign.id = link.campaign_id
  JOIN program_iterations iteration ON iteration.id = link.iteration_id
  LEFT JOIN analytics_research_design_registry registry
    ON registry.iteration_id = iteration.id
  WHERE campaign.status <> 'ARCHIVED'
  WINDOW campaign_order AS (
    PARTITION BY campaign.id ORDER BY iteration.iteration_number, iteration.created_at, iteration.id
  )
), qualified AS (
  SELECT
    design.*,
    previous_questionnaire_fingerprint IS NULL AS is_baseline,
    questionnaire_fingerprint = previous_questionnaire_fingerprint
      AS questionnaire_comparable,
    COALESCE(target_population, '') = COALESCE(previous_target_population, '')
      AS population_comparable,
    COALESCE(sample_frame_name, '') = COALESCE(previous_sample_frame_name, '')
      AS sample_frame_comparable,
    COALESCE(sampling_method, '') = COALESCE(previous_sampling_method, '')
      AS sampling_method_comparable,
    COALESCE(weighting_status, '') = COALESCE(previous_weighting_status, '')
      AND COALESCE(weighting_method, '') = COALESCE(previous_weighting_method, '')
      AS weighting_comparable,
    COALESCE(fieldwork_mode, '') = COALESCE(previous_fieldwork_mode, '')
      AS fieldwork_mode_comparable,
    declared_at IS NOT NULL AS design_declared,
    previous_declared_at IS NOT NULL AS previous_design_declared
  FROM design
)
SELECT
  qualified.*,
  CASE
    WHEN is_baseline THEN 'BASELINE'
    WHEN NOT design_declared OR NOT previous_design_declared THEN 'NOT_COMPARABLE'
    WHEN edges.instrument_recorded AND edges.previous_instrument_recorded
      AND qualified.questionnaire_id = edges.previous_questionnaire_id
      AND qualified.iteration_number = edges.previous_iteration_number + 1
      AND COALESCE(qualified.selection_method, '') = COALESCE(edges.previous_selection_method, '')
      AND COALESCE(qualified.weighting_variables, '[]'::jsonb) = COALESCE(edges.previous_weighting_variables, '[]'::jsonb)
      AND questionnaire_comparable
      AND population_comparable
      AND sample_frame_comparable
      AND sampling_method_comparable
      AND weighting_comparable
      AND fieldwork_mode_comparable
      THEN 'COMPARABLE'
    ELSE 'NOT_COMPARABLE'
  END AS comparison_status,
  ARRAY_REMOVE(ARRAY[
    CASE WHEN NOT is_baseline AND qualified.questionnaire_id IS DISTINCT FROM edges.previous_questionnaire_id
      THEN 'Questionnaire identity changed' END,
    CASE WHEN NOT edges.instrument_recorded
      THEN 'Frozen questionnaire identity is missing or inconsistent' END,
    CASE WHEN NOT is_baseline AND NOT COALESCE(edges.previous_instrument_recorded, FALSE)
      THEN 'Previous Iteration frozen questionnaire identity is missing or inconsistent' END,
    CASE WHEN NOT is_baseline AND qualified.iteration_number <> edges.previous_iteration_number + 1
      THEN 'Iteration numbers are not consecutive' END,
    CASE WHEN NOT is_baseline AND COALESCE(qualified.selection_method, '') <> COALESCE(edges.previous_selection_method, '')
      THEN 'Respondent selection method changed' END,
    CASE WHEN NOT is_baseline AND COALESCE(qualified.weighting_variables, '[]'::jsonb) <> COALESCE(edges.previous_weighting_variables, '[]'::jsonb)
      THEN 'Weighting variables changed' END,
    CASE WHEN NOT design_declared THEN 'Research design has not been declared' END,
    CASE WHEN NOT is_baseline AND NOT previous_design_declared
      THEN 'Previous Iteration research design has not been declared' END,
    CASE WHEN NOT is_baseline AND NOT questionnaire_comparable
      THEN 'Questionnaire identity changed' END,
    CASE WHEN NOT is_baseline AND NOT population_comparable
      THEN 'Target population changed' END,
    CASE WHEN NOT is_baseline AND NOT sample_frame_comparable
      THEN 'Sample frame changed' END,
    CASE WHEN NOT is_baseline AND NOT sampling_method_comparable
      THEN 'Sampling method changed' END,
    CASE WHEN NOT is_baseline AND NOT weighting_comparable
      THEN 'Weighting approach changed' END,
    CASE WHEN NOT is_baseline AND NOT fieldwork_mode_comparable
      THEN 'Fieldwork mode changed' END
  ], NULL)::text[] AS comparison_reasons,
  edges.previous_iteration_id
FROM qualified
JOIN edges ON edges.iteration_id = qualified.iteration_id;

COMMENT ON VIEW analytics_iteration_comparability_v1 IS
  'Automated gate for repeated-wave comparison based on questionnaire identity and declared research design.';

CREATE OR REPLACE VIEW analytics_iteration_movement_v1 AS
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
), movement AS (
  SELECT
    signal.*,
    LAG(signal.iteration_id) OVER wave_order AS previous_evidence_iteration_id,
    LAG(signal.respondent_base) OVER wave_order AS previous_respondent_base,
    LAG(signal.direct_measure_base) OVER wave_order AS previous_direct_measure_base,
    signal.average_direct_party_strength - LAG(signal.average_direct_party_strength)
      OVER (PARTITION BY signal.campaign_id ORDER BY signal.iteration_number)
      AS unqualified_party_strength_change,
    signal.positive_sentiment_pct - LAG(signal.positive_sentiment_pct)
      OVER (PARTITION BY signal.campaign_id ORDER BY signal.iteration_number)
      AS unqualified_positive_sentiment_change_pct,
    signal.candidate_positive_pct - LAG(signal.candidate_positive_pct)
      OVER (PARTITION BY signal.campaign_id ORDER BY signal.iteration_number)
      AS unqualified_candidate_positive_change_pct
  FROM iteration_signal signal
  WINDOW wave_order AS (PARTITION BY signal.campaign_id ORDER BY signal.iteration_number)
), reportable AS (
  SELECT movement.*,
    comparability.comparison_status,
    comparability.comparison_reasons AS design_reasons,
    comparability.previous_iteration_id,
    CASE
      WHEN movement.respondent_base < 5 THEN 'SUPPRESSED'
      WHEN comparability.comparison_status = 'BASELINE' THEN 'BASELINE'
      WHEN comparability.comparison_status <> 'COMPARABLE' THEN 'NOT_COMPARABLE'
      WHEN movement.previous_evidence_iteration_id IS DISTINCT FROM comparability.previous_iteration_id
        THEN 'NOT_COMPARABLE'
      WHEN movement.previous_respondent_base < 5 THEN 'SUPPRESSED'
      ELSE 'COMPARABLE'
    END AS movement_status
  FROM movement
  JOIN analytics_iteration_comparability_v1 comparability
    ON comparability.iteration_id = movement.iteration_id
)
SELECT
  movement.program_id,
  movement.program_code,
  movement.program_name,
  movement.campaign_id,
  movement.campaign_code,
  movement.campaign_name,
  movement.iteration_id,
  movement.iteration_number,
  movement.iteration_name,
  movement.respondent_base,
  CASE WHEN movement.respondent_base >= 5 AND movement.direct_measure_base >= 5
    THEN movement.average_direct_party_strength ELSE NULL END AS average_direct_party_strength,
  movement.direct_measure_base,
  CASE WHEN movement.respondent_base >= 5 THEN movement.positive_sentiment_pct ELSE NULL END AS positive_sentiment_pct,
  CASE WHEN movement.respondent_base >= 5 THEN movement.negative_sentiment_pct ELSE NULL END AS negative_sentiment_pct,
  CASE WHEN movement.respondent_base >= 5 THEN movement.candidate_positive_pct ELSE NULL END AS candidate_positive_pct,
  movement.issue_response_base,
  CASE WHEN movement.movement_status = 'COMPARABLE'
    AND movement.direct_measure_base >= 5 AND movement.previous_direct_measure_base >= 5
    THEN ROUND(movement.unqualified_party_strength_change, 2)
    ELSE NULL
  END AS party_strength_change,
  CASE WHEN movement.movement_status = 'COMPARABLE'
    THEN ROUND(movement.unqualified_positive_sentiment_change_pct, 1)
    ELSE NULL
  END AS positive_sentiment_change_pct,
  CASE WHEN movement.movement_status = 'COMPARABLE'
    THEN ROUND(movement.unqualified_candidate_positive_change_pct, 1)
    ELSE NULL
  END AS candidate_positive_change_pct,
  movement.movement_status AS comparison_basis,
  CASE
    WHEN movement.movement_status = 'COMPARABLE'
      THEN 'Comparable aggregate movement; not a causal campaign-effect estimate'
    WHEN movement.movement_status = 'BASELINE'
      THEN 'Baseline wave; change becomes available after a comparable subsequent Iteration'
    WHEN movement.movement_status = 'SUPPRESSED'
      THEN 'Movement suppressed: each adjacent wave requires at least five respondents'
    ELSE 'Movement suppressed because consecutive waves or declared research design are not comparable'
  END::text AS interpretation_label,
  ARRAY_REMOVE(movement.design_reasons || ARRAY[
    CASE WHEN movement.respondent_base < 5 OR movement.previous_respondent_base < 5
      THEN 'Fewer than five respondents in one or both waves' END,
    CASE WHEN movement.comparison_status <> 'BASELINE'
      AND movement.previous_evidence_iteration_id IS DISTINCT FROM movement.previous_iteration_id
      THEN 'Previous Campaign Iteration has no reportable evidence; missing waves are not bridged' END,
    CASE WHEN movement.direct_measure_base < 5 OR movement.previous_direct_measure_base < 5
      THEN 'Direct party-strength movement requires five answered direct measures in each wave' END
  ], NULL)::text[] AS comparison_reasons
FROM reportable movement;

COMMENT ON VIEW analytics_iteration_movement_v1 IS
  'Aggregate Iteration signals with change measures exposed only when the automated comparability gate passes.';

COMMIT;
