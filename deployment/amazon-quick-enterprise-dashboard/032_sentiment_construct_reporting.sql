BEGIN;

-- Additive reporting correction only. Retain every existing view column and
-- historical answer; do not infer sentiment from awareness, suitability or
-- another question. The normalizer is generated from the audited shared rules.
CREATE OR REPLACE FUNCTION analytics_select_output_v2(response_values jsonb, requested_keys text[])
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $select_output$
DECLARE
  output_key text;
  raw_value jsonb;
  normalized jsonb;
  selected jsonb;
  source_keys text[] := ARRAY[]::text[];
  first_signature text;
  contradictory boolean := FALSE;
  -- ECMAScript String.trim whitespace, including tabs/newlines, NBSP and BOM.
  trim_characters text := E' \t\n\r\f\013' || chr(160) || chr(5760)
    || chr(8192) || chr(8193) || chr(8194) || chr(8195) || chr(8196)
    || chr(8197) || chr(8198) || chr(8199) || chr(8200) || chr(8201)
    || chr(8202) || chr(8232) || chr(8233) || chr(8239) || chr(8287)
    || chr(12288) || chr(65279);
BEGIN
  FOREACH output_key IN ARRAY COALESCE(requested_keys, ARRAY[]::text[]) LOOP
    SELECT CASE WHEN COUNT(DISTINCT item.value) > 1
      THEN '{"conflicting_output_aliases":true}'::jsonb
      ELSE (array_agg(item.value))[1] END
    INTO raw_value
    FROM jsonb_each(CASE WHEN jsonb_typeof(response_values) = 'object'
      THEN response_values ELSE '{}'::jsonb END) item
    WHERE lower(btrim(item.key, trim_characters)) = lower(btrim(output_key, trim_characters));
    normalized := analytics_normalize_output_v1(output_key, raw_value);
    IF normalized ->> 'status' <> 'MISSING' THEN
      source_keys := array_append(source_keys, output_key);
      normalized := normalized || jsonb_build_object('sourceKey', output_key);
      IF selected IS NULL THEN
        selected := normalized;
        first_signature := (normalized ->> 'status') || ':' || (normalized ->> 'label');
      ELSIF selected ->> 'domain' IN ('assessment', 'suitability')
        AND first_signature IS DISTINCT FROM ((normalized ->> 'status') || ':' || (normalized ->> 'label')) THEN
        contradictory := TRUE;
      END IF;
    END IF;
  END LOOP;
  IF selected IS NULL THEN
    RETURN analytics_normalize_output_v1(requested_keys[1], NULL)
      || jsonb_build_object('sourceKeys', to_jsonb(source_keys));
  END IF;
  IF contradictory THEN
    selected := selected || jsonb_build_object('status', 'UNCODED', 'label', 'Uncoded response');
  END IF;
  RETURN selected || jsonb_build_object('sourceKeys', to_jsonb(source_keys));
END;
$select_output$;

CREATE OR REPLACE VIEW analytics_research_enterprise_v2 AS
WITH latest_connected_evidence AS (
  SELECT DISTINCT ON (link.campaign_id, call_record.iteration_id,
    COALESCE(call_record.voter_id, call_record.id))
    link.campaign_id AS scope_campaign_id, call_record.*
  FROM campaign_iteration_links link
  JOIN calls call_record ON call_record.iteration_id = link.iteration_id
  WHERE LOWER(COALESCE(call_record.connectivity_status, '')) = 'connected'
    AND jsonb_typeof(call_record.response_variables) = 'object'
    AND call_record.response_variables <> '{}'::jsonb
    AND call_record.voter_id IS NOT NULL
  ORDER BY link.campaign_id, call_record.iteration_id,
    COALESCE(call_record.voter_id, call_record.id),
    COALESCE(call_record.updated_at, call_record.first_seen_at) DESC NULLS LAST,
    call_record.first_seen_at DESC NULLS LAST, call_record.id DESC
), reporting_rows AS (
  SELECT
    program.id AS program_id, program.study_code AS program_code,
    program.study_name AS program_name, campaign.id AS campaign_id,
    campaign.campaign_code, campaign.campaign_name,
    campaign.status AS campaign_status, campaign.survey_stage,
    campaign.target_type, campaign.target_code AS constituency_code,
    COALESCE(voter.assembly_constituency_name, campaign.target_name) AS constituency_name,
    campaign.campaign_manager_user_id, campaign.created_by_user_id,
    iteration.id AS iteration_id, iteration.iteration_number, iteration.iteration_name,
    COALESCE(link.status, iteration.status) AS iteration_status,
    run.id AS run_id, run.run_number, run.run_name, run.status AS run_status,
    MD5(COALESCE(evidence.voter_id::text, evidence.id::text)) AS respondent_key,
    CASE
      WHEN LOWER(TRIM(COALESCE(voter.gender, ''))) IN ('f', 'female', 'woman') THEN 'Female'
      WHEN LOWER(TRIM(COALESCE(voter.gender, ''))) IN ('m', 'male', 'man') THEN 'Male'
      WHEN TRIM(COALESCE(voter.gender, '')) = '' THEN 'Unknown'
      ELSE 'Other / self-described'
    END AS gender,
    voter.age,
    CASE WHEN voter.age BETWEEN 18 AND 29 THEN '18–29'
      WHEN voter.age BETWEEN 30 AND 39 THEN '30–39'
      WHEN voter.age BETWEEN 40 AND 49 THEN '40–49'
      WHEN voter.age >= 50 THEN '50+' ELSE 'Unknown' END AS age_band,
    COALESCE(NULLIF(TRIM(voter.mandal_name_source), ''), 'Unknown') AS mandal_name,
    evidence.duration_seconds,
    COALESCE(evidence.updated_at, evidence.first_seen_at) AS response_recorded_at,
    evidence.response_variables
  FROM latest_connected_evidence evidence
  JOIN campaign_iteration_links link ON link.campaign_id = evidence.scope_campaign_id
    AND link.iteration_id = evidence.iteration_id
  JOIN campaigns campaign ON campaign.id = evidence.scope_campaign_id
  LEFT JOIN survey_studies program ON program.id = campaign.program_id
  JOIN program_iterations iteration ON iteration.id = evidence.iteration_id
  LEFT JOIN campaign_runs run ON run.id = evidence.run_id
  LEFT JOIN voter_master voter ON voter.id = evidence.voter_id
  WHERE campaign.status <> 'ARCHIVED'
), normalized_rows AS (
  SELECT source.*,
    analytics_select_output_v2(source.response_variables, ARRAY['graduate_issue_priority', 'issue_priority']) AS issue_normalized,
    analytics_select_output_v2(source.response_variables, ARRAY['party_salience_unaided', 'party_salience', 'party_attention', 'party_preference']) AS party_normalized,
    analytics_select_output_v2(source.response_variables, ARRAY['perceived_issue_leader_aided', 'perceived_issue_leader', 'leadership_preference', 'party_leadership']) AS leader_normalized,
    analytics_select_output_v2(source.response_variables, ARRAY['candidate_name', 'candidate_reference']) AS candidate_normalized,
    analytics_select_output_v2(source.response_variables, ARRAY['incumbent_assessment']) AS sentiment_normalized,
    analytics_select_output_v2(source.response_variables, ARRAY['candidate_impression', 'candidate_sentiment', 'veeresh_impression']) AS assessment_normalized
  FROM reporting_rows source
)
SELECT
  program_id, program_code, program_name, campaign_id, campaign_code, campaign_name,
  campaign_status, survey_stage, target_type, constituency_code, constituency_name,
  campaign_manager_user_id, created_by_user_id,
  iteration_id, iteration_number, iteration_name, iteration_status,
  run_id, run_number, run_name, run_status, respondent_key, gender, age, age_band,
  mandal_name, duration_seconds, response_recorded_at,
  COALESCE(issue_normalized ->> 'label', 'No response') AS issue_priority,
  COALESCE(party_normalized ->> 'label', 'No response') AS party_salience,
  COALESCE(leader_normalized ->> 'label', 'No response') AS party_leadership,
  COALESCE(candidate_normalized ->> 'label', 'No response') AS candidate_name,
  COALESCE(assessment_normalized ->> 'label', 'No response') AS candidate_sentiment,
  COALESCE(sentiment_normalized ->> 'label', 'No response') AS respondent_sentiment,
  CASE WHEN COALESCE(response_variables ->> 'party_lean_rating',
      response_variables ->> 'party_lean_strength', response_variables ->> 'brs_lean_rating') ~ '^[1-5]$'
    THEN LEAST(GREATEST(COALESCE(response_variables ->> 'party_lean_rating',
      response_variables ->> 'party_lean_strength', response_variables ->> 'brs_lean_rating')::numeric, 1), 5)
    ELSE NULL END AS direct_party_strength,
  issue_normalized ->> 'status' AS issue_priority_status,
  party_normalized ->> 'status' AS party_salience_status,
  leader_normalized ->> 'status' AS party_leadership_status,
  candidate_normalized ->> 'status' AS candidate_name_status,
  assessment_normalized ->> 'status' AS candidate_sentiment_status,
  sentiment_normalized ->> 'status' AS respondent_sentiment_status,
  issue_normalized ->> 'sourceKey' AS issue_source_key,
  party_normalized ->> 'sourceKey' AS party_source_key,
  leader_normalized ->> 'sourceKey' AS leader_source_key,
  candidate_normalized ->> 'sourceKey' AS candidate_source_key,
  sentiment_normalized ->> 'sourceKey' AS sentiment_source_key,
  assessment_normalized ->> 'sourceKey' AS assessment_source_key,
  sentiment_normalized ->> 'version' AS normalization_version
FROM normalized_rows;

COMMENT ON VIEW analytics_research_enterprise_v2 IS
  'Descriptive explicit-label reporting; human review pending. respondent_sentiment is incumbent_assessment only; candidate_sentiment is candidate impression only, never suitability. Mixed is distinct from Neutral. Contradictory assessment aliases are Uncoded. Raw answers remain in privileged call records and are not rewritten. No validated NLP, electoral forecast or individual political inference.';

-- Reuse the already-qualified movement equations and fixed column signature.
-- Only the construct/interpretation labels change; 031 comparison gate remains.
DO $movement_labels$
DECLARE
  definition text := pg_get_viewdef('analytics_iteration_movement_v2'::regclass, TRUE);
BEGIN
  IF position('Primary recorded civic/incumbent assessment: issue, development, change, then incumbent' IN definition) = 0
    AND position('Incumbent performance assessment only: incumbent_assessment' IN definition) = 0 THEN
    RAISE EXCEPTION 'Unknown movement sentiment construct; reporting correction not applied';
  END IF;
  IF position('Candidate assessment: first recorded impression/sentiment, then criterion fit' IN definition) = 0
    AND position('Candidate impression only: candidate_impression, candidate_sentiment, veeresh_impression' IN definition) = 0 THEN
    RAISE EXCEPTION 'Unknown movement candidate construct; reporting correction not applied';
  END IF;
  definition := replace(definition,
    'Primary recorded civic/incumbent assessment: issue, development, change, then incumbent',
    'Incumbent performance assessment only: incumbent_assessment');
  definition := replace(definition,
    'Candidate assessment: first recorded impression/sentiment, then criterion fit',
    'Candidate impression only: candidate_impression, candidate_sentiment, veeresh_impression');
  definition := replace(definition,
    'Qualified adjacent-wave movement; measure-specific answer bases shown; not a causal effect',
    'Descriptive adjacent-wave movement; human review pending; measure-specific answer bases shown; not a causal effect or validated prediction');
  EXECUTE 'CREATE OR REPLACE VIEW analytics_iteration_movement_v2 AS ' || definition;
END;
$movement_labels$;

COMMIT;
