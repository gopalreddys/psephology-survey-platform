BEGIN;

CREATE TABLE IF NOT EXISTS analytics_research_design_registry (
  iteration_id uuid PRIMARY KEY
    REFERENCES program_iterations(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL
    REFERENCES campaigns(id) ON DELETE CASCADE,
  target_population text NOT NULL DEFAULT 'Not declared',
  sample_frame_name text,
  sampling_method text NOT NULL DEFAULT 'DIRECTIONAL_NON_PROBABILITY'
    CHECK (sampling_method IN (
      'CENSUS', 'SIMPLE_RANDOM', 'STRATIFIED_RANDOM', 'CLUSTER',
      'SYSTEMATIC', 'QUOTA', 'PURPOSIVE', 'CONVENIENCE',
      'DIRECTIONAL_NON_PROBABILITY'
    )),
  selection_method text,
  weighting_status text NOT NULL DEFAULT 'NOT_CONFIGURED'
    CHECK (weighting_status IN ('NOT_CONFIGURED', 'NOT_REQUIRED', 'PLANNED', 'APPLIED')),
  weighting_method text,
  weighting_variables jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(weighting_variables) = 'array'),
  fieldwork_mode text NOT NULL DEFAULT 'AI_ASSISTED_OUTBOUND_VOICE',
  methodology_notes text,
  declared_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  declared_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, iteration_id)
);

COMMENT ON TABLE analytics_research_design_registry IS
  'Declared Iteration-level sampling, frame and weighting methodology used to qualify repeated-wave comparisons.';

INSERT INTO analytics_research_design_registry (
  iteration_id,
  campaign_id,
  target_population,
  sample_frame_name,
  sampling_method,
  selection_method,
  weighting_status,
  fieldwork_mode,
  methodology_notes
)
SELECT
  iteration.id,
  link.campaign_id,
  'Not declared',
  NULL,
  'DIRECTIONAL_NON_PROBABILITY',
  COALESCE(NULLIF(TRIM(iteration.sample_design_type), ''), 'Repeated cross-section'),
  'NOT_CONFIGURED',
  'AI_ASSISTED_OUTBOUND_VOICE',
  'Migration default. An Admin or Super Admin must review and declare the research design.'
FROM campaign_iteration_links link
JOIN program_iterations iteration ON iteration.id = link.iteration_id
JOIN campaigns campaign ON campaign.id = link.campaign_id
WHERE campaign.status <> 'ARCHIVED'
ON CONFLICT (iteration_id) DO NOTHING;

CREATE OR REPLACE VIEW analytics_iteration_comparability_v1 AS
WITH design AS (
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
    PARTITION BY campaign.id ORDER BY iteration.iteration_number, iteration.created_at
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
    WHEN questionnaire_comparable
      AND population_comparable
      AND sample_frame_comparable
      AND sampling_method_comparable
      AND weighting_comparable
      AND fieldwork_mode_comparable
      THEN 'COMPARABLE'
    ELSE 'NOT_COMPARABLE'
  END AS comparison_status,
  ARRAY_REMOVE(ARRAY[
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
  ], NULL)::text[] AS comparison_reasons
FROM qualified;

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
  movement.average_direct_party_strength,
  movement.direct_measure_base,
  movement.positive_sentiment_pct,
  movement.negative_sentiment_pct,
  movement.candidate_positive_pct,
  movement.issue_response_base,
  CASE WHEN comparability.comparison_status = 'COMPARABLE'
    THEN ROUND(movement.unqualified_party_strength_change, 2)
    ELSE NULL
  END AS party_strength_change,
  CASE WHEN comparability.comparison_status = 'COMPARABLE'
    THEN ROUND(movement.unqualified_positive_sentiment_change_pct, 1)
    ELSE NULL
  END AS positive_sentiment_change_pct,
  CASE WHEN comparability.comparison_status = 'COMPARABLE'
    THEN ROUND(movement.unqualified_candidate_positive_change_pct, 1)
    ELSE NULL
  END AS candidate_positive_change_pct,
  comparability.comparison_status AS comparison_basis,
  CASE
    WHEN comparability.comparison_status = 'COMPARABLE'
      THEN 'Comparable aggregate movement; not a causal campaign-effect estimate'
    WHEN comparability.comparison_status = 'BASELINE'
      THEN 'Baseline wave; change becomes available after a comparable subsequent Iteration'
    ELSE 'Movement suppressed because questionnaire or declared research design is not comparable'
  END::text AS interpretation_label,
  comparability.comparison_reasons
FROM movement
JOIN analytics_iteration_comparability_v1 comparability
  ON comparability.iteration_id = movement.iteration_id;

COMMENT ON VIEW analytics_iteration_movement_v1 IS
  'Aggregate Iteration signals with change measures exposed only when the automated comparability gate passes.';

COMMIT;
