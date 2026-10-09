BEGIN;

-- Never infer historical methods or manufacture earlier question content.
ALTER TABLE analytics_research_design_registry
  ADD COLUMN IF NOT EXISTS cohort_design text NOT NULL DEFAULT 'NOT_DECLARED',
  ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS analytics_research_design_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  iteration_id uuid NOT NULL,
  campaign_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  actor_user_id uuid NOT NULL,
  change_reason text NOT NULL CHECK (length(trim(change_reason)) > 0),
  design_snapshot jsonb NOT NULL CHECK (jsonb_typeof(design_snapshot) = 'object'),
  declared_at timestamptz NOT NULL,
  UNIQUE (iteration_id, revision)
);
-- Source IDs deliberately have no cascading FKs: historical declarations
-- remain retained even if an operational source record is removed later.
CREATE OR REPLACE FUNCTION analytics_research_audit_append_only_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Research methodology audit records are append-only' USING ERRCODE = '23514';
END;
$$;
DROP TRIGGER IF EXISTS research_audit_append_only ON analytics_research_design_audit;
CREATE TRIGGER research_audit_append_only BEFORE UPDATE OR DELETE ON analytics_research_design_audit
  FOR EACH ROW EXECUTE FUNCTION analytics_research_audit_append_only_v1();
DROP TRIGGER IF EXISTS research_audit_no_truncate ON analytics_research_design_audit;
CREATE TRIGGER research_audit_no_truncate BEFORE TRUNCATE ON analytics_research_design_audit
  FOR EACH STATEMENT EXECUTE FUNCTION analytics_research_audit_append_only_v1();

CREATE OR REPLACE FUNCTION analytics_methodology_complete_v1(design jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(
    design->>'declared_at' IS NOT NULL AND design->>'declared_by_user_id' IS NOT NULL
    AND COALESCE((design->>'revision')::integer, 0) > 0
    AND NULLIF(TRIM(design->>'target_population'), '') IS NOT NULL
    AND LOWER(TRIM(design->>'target_population')) NOT IN ('not declared', 'unknown', 'n/a', 'na', 'tbd', 'not specified')
    AND NULLIF(TRIM(design->>'sample_frame_name'), '') IS NOT NULL
    AND LOWER(TRIM(design->>'sample_frame_name')) NOT IN ('not declared', 'unknown', 'n/a', 'na', 'tbd', 'not specified')
    AND NULLIF(TRIM(design->>'selection_method'), '') IS NOT NULL
    AND LOWER(TRIM(design->>'selection_method')) NOT IN ('not declared', 'unknown', 'n/a', 'na', 'tbd', 'not specified')
    AND design->>'cohort_design' IN ('SAME_PARTICIPANTS', 'INDEPENDENT_SAMPLES', 'PARTIAL_OVERLAP')
    AND design->>'sampling_method' IN ('CENSUS', 'SIMPLE_RANDOM', 'STRATIFIED_RANDOM', 'CLUSTER', 'SYSTEMATIC', 'QUOTA', 'PURPOSIVE', 'CONVENIENCE', 'DIRECTIONAL_NON_PROBABILITY')
    AND design->>'fieldwork_mode' IN ('AI_ASSISTED_OUTBOUND_VOICE', 'HUMAN_ASSISTED_PHONE', 'MIXED_MODE')
    AND ((design->>'weighting_status' = 'NOT_REQUIRED'
      AND NULLIF(TRIM(design->>'weighting_method'), '') IS NULL
      AND design->'weighting_variables' = '[]'::jsonb)
      OR (design->>'weighting_status' = 'PLANNED'
        AND NULLIF(TRIM(design->>'weighting_method'), '') IS NOT NULL
        AND CASE WHEN jsonb_typeof(design->'weighting_variables') = 'array'
          THEN jsonb_array_length(design->'weighting_variables') > 0 ELSE FALSE END)),
    FALSE);
$$;

CREATE OR REPLACE FUNCTION analytics_frozen_questionnaire_recorded_v1(snapshot jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(
    jsonb_typeof(snapshot) = 'object'
    AND snapshot->>'snapshot_schema_version' = '2'
    AND snapshot->>'question_provenance' = 'FROZEN_AT_SELECTION'
    AND snapshot->>'content_fingerprint' ~ '^[0-9a-f]{64}$'
    AND CASE WHEN jsonb_typeof(snapshot->'questions') = 'array'
      THEN jsonb_array_length(snapshot->'questions') > 0 ELSE FALSE END
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(CASE
        WHEN jsonb_typeof(snapshot->'questions') = 'array' THEN snapshot->'questions' ELSE '[]'::jsonb END) question
      WHERE jsonb_typeof(question) IS DISTINCT FROM 'object'
        OR jsonb_typeof(question->'question_code') IS DISTINCT FROM 'string'
        OR NULLIF(TRIM(question->>'question_code'), '') IS NULL
        OR jsonb_typeof(question->'question_text') IS DISTINCT FROM 'string'
        OR NULLIF(TRIM(question->>'question_text'), '') IS NULL
    ), FALSE);
$$;

-- Keep every existing gate column and type unchanged so migration replay is safe.
CREATE OR REPLACE VIEW analytics_iteration_comparability_v1 AS
WITH edges AS (
  SELECT iteration.id AS iteration_id,
    LAG(iteration.id) OVER campaign_order AS previous_iteration_id,
    LAG(iteration.iteration_number) OVER campaign_order AS previous_iteration_number,
    LAG(iteration.questionnaire_id) OVER campaign_order AS previous_questionnaire_id,
    (iteration.questionnaire_id IS NOT NULL
      AND analytics_frozen_questionnaire_recorded_v1(iteration.questionnaire_snapshot)
      AND jsonb_typeof(iteration.questionnaire_snapshot) = 'object'
      AND NULLIF(TRIM(iteration.questionnaire_snapshot->>'code'), '') IS NOT NULL
      AND NULLIF(TRIM(iteration.questionnaire_snapshot->>'version'), '') IS NOT NULL
      AND (iteration.questionnaire_snapshot->>'id' IS NULL
        OR iteration.questionnaire_snapshot->>'id' = iteration.questionnaire_id::text)
    ) IS TRUE AS instrument_recorded,
    LAG((iteration.questionnaire_id IS NOT NULL
      AND analytics_frozen_questionnaire_recorded_v1(iteration.questionnaire_snapshot)
      AND jsonb_typeof(iteration.questionnaire_snapshot) = 'object'
      AND NULLIF(TRIM(iteration.questionnaire_snapshot->>'code'), '') IS NOT NULL
      AND NULLIF(TRIM(iteration.questionnaire_snapshot->>'version'), '') IS NOT NULL
      AND (iteration.questionnaire_snapshot->>'id' IS NULL
        OR iteration.questionnaire_snapshot->>'id' = iteration.questionnaire_id::text)
    ) IS TRUE) OVER campaign_order AS previous_instrument_recorded,
    LAG(registry.weighting_variables) OVER campaign_order AS previous_weighting_variables,
    LAG(registry.selection_method) OVER campaign_order AS previous_selection_method,
    registry.cohort_design,
    LAG(registry.cohort_design) OVER campaign_order AS previous_cohort_design,
    analytics_methodology_complete_v1(to_jsonb(registry)) AS complete_declaration,
    LAG(analytics_methodology_complete_v1(to_jsonb(registry))) OVER campaign_order AS previous_complete_declaration
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
    COALESCE(edges.complete_declaration, FALSE) AS design_declared,
    COALESCE(edges.previous_complete_declaration, FALSE) AS previous_design_declared
  FROM design JOIN edges ON edges.iteration_id = design.iteration_id
)
SELECT
  qualified.*,
  CASE
    WHEN is_baseline THEN 'BASELINE'
    WHEN NOT design_declared OR NOT previous_design_declared THEN 'NOT_COMPARABLE'
    WHEN edges.instrument_recorded AND edges.previous_instrument_recorded
      AND edges.cohort_design = edges.previous_cohort_design
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
      THEN 'Frozen questionnaire identity or question content is missing or inconsistent' END,
    CASE WHEN NOT is_baseline AND NOT COALESCE(edges.previous_instrument_recorded, FALSE)
      THEN 'Previous Iteration frozen questionnaire identity or question content is missing or inconsistent' END,
    CASE WHEN NOT is_baseline AND qualified.iteration_number <> edges.previous_iteration_number + 1
      THEN 'Iteration numbers are not consecutive' END,
    CASE WHEN NOT is_baseline AND COALESCE(qualified.selection_method, '') <> COALESCE(edges.previous_selection_method, '')
      THEN 'Respondent selection method changed' END,
    CASE WHEN NOT is_baseline AND COALESCE(qualified.weighting_variables, '[]'::jsonb) <> COALESCE(edges.previous_weighting_variables, '[]'::jsonb)
      THEN 'Weighting variables changed' END,
    CASE WHEN NOT is_baseline AND edges.cohort_design IS DISTINCT FROM edges.previous_cohort_design
      THEN 'Participant cohort design changed' END,
    CASE WHEN NOT design_declared THEN 'Research methodology is undeclared or incomplete; verify population, frame, selection, cohort and weighting' END,
    CASE WHEN NOT is_baseline AND NOT previous_design_declared
      THEN 'Previous Iteration research methodology is undeclared or incomplete' END,
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
  'Conservative full-instrument, consecutive-wave comparison gate; complete actual methodology and frozen question content required. Not a statistical confidence measure.';

CREATE OR REPLACE VIEW analytics_research_design_registry_v2 AS
SELECT gate.*, registry.cohort_design, registry.revision,
  analytics_frozen_questionnaire_recorded_v1(iteration.questionnaire_snapshot) AS question_content_recorded,
  CASE WHEN jsonb_typeof(iteration.questionnaire_snapshot->'questions') = 'array'
    THEN jsonb_array_length(iteration.questionnaire_snapshot->'questions') ELSE 0 END AS frozen_question_count,
  iteration.questionnaire_snapshot->>'content_fingerprint' AS question_content_fingerprint
FROM analytics_iteration_comparability_v1 gate
LEFT JOIN analytics_research_design_registry registry ON registry.iteration_id = gate.iteration_id
JOIN program_iterations iteration ON iteration.id = gate.iteration_id;

COMMIT;

