BEGIN;

-- analytics_normalize_output_v1 is generated from the same audited JSON rule
-- source as native analytics before this migration runs. Existing v1 views and
-- published BI assets are retained; no historical answer is rewritten.
CREATE OR REPLACE FUNCTION analytics_output_value_v1(response_values jsonb, requested_key text)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $output_value$
  SELECT CASE WHEN COUNT(DISTINCT item.value) > 1 THEN '{"conflicting_output_aliases":true}'::jsonb
    ELSE (array_agg(item.value))[1] END
  FROM jsonb_each(CASE WHEN jsonb_typeof(response_values) = 'object' THEN response_values ELSE '{}'::jsonb END) item
  WHERE lower(btrim(item.key)) = lower(btrim(requested_key));
$output_value$;

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
    issue.output_key AS issue_source_key,
    issue.normalized AS issue_normalized,
    party.output_key AS party_source_key,
    party.normalized AS party_normalized,
    leader.output_key AS leader_source_key,
    leader.normalized AS leader_normalized,
    candidate.output_key AS candidate_source_key,
    candidate.normalized AS candidate_normalized,
    sentiment.output_key AS sentiment_source_key,
    sentiment.normalized AS sentiment_normalized,
    assessment.output_key AS assessment_source_key,
    assessment.normalized AS assessment_normalized
  FROM reporting_rows source
  LEFT JOIN LATERAL (
    SELECT output_key,
      analytics_normalize_output_v1(output_key, analytics_output_value_v1(source.response_variables, output_key)) AS normalized
    FROM unnest(ARRAY['graduate_issue_priority', 'issue_priority']) WITH ORDINALITY key(output_key, position)
    ORDER BY (analytics_normalize_output_v1(output_key, analytics_output_value_v1(source.response_variables, output_key)) ->> 'status' = 'MISSING'), position LIMIT 1
  ) issue ON TRUE
  LEFT JOIN LATERAL (
    SELECT output_key,
      analytics_normalize_output_v1(output_key, analytics_output_value_v1(source.response_variables, output_key)) AS normalized
    FROM unnest(ARRAY['party_salience_unaided', 'party_salience', 'party_attention', 'party_preference']) WITH ORDINALITY key(output_key, position)
    ORDER BY (analytics_normalize_output_v1(output_key, analytics_output_value_v1(source.response_variables, output_key)) ->> 'status' = 'MISSING'), position LIMIT 1
  ) party ON TRUE
  LEFT JOIN LATERAL (
    SELECT output_key,
      analytics_normalize_output_v1(output_key, analytics_output_value_v1(source.response_variables, output_key)) AS normalized
    FROM unnest(ARRAY['perceived_issue_leader_aided', 'perceived_issue_leader', 'leadership_preference', 'party_leadership']) WITH ORDINALITY key(output_key, position)
    ORDER BY (analytics_normalize_output_v1(output_key, analytics_output_value_v1(source.response_variables, output_key)) ->> 'status' = 'MISSING'), position LIMIT 1
  ) leader ON TRUE
  LEFT JOIN LATERAL (
    SELECT output_key,
      analytics_normalize_output_v1(output_key, analytics_output_value_v1(source.response_variables, output_key)) AS normalized
    FROM unnest(ARRAY['candidate_name', 'candidate_reference']) WITH ORDINALITY key(output_key, position)
    ORDER BY (analytics_normalize_output_v1(output_key, analytics_output_value_v1(source.response_variables, output_key)) ->> 'status' = 'MISSING'), position LIMIT 1
  ) candidate ON TRUE
  LEFT JOIN LATERAL (
    SELECT output_key,
      analytics_normalize_output_v1(output_key, analytics_output_value_v1(source.response_variables, output_key)) AS normalized
    FROM unnest(ARRAY['issue_sentiment', 'development_sentiment', 'change_sentiment', 'incumbent_assessment']) WITH ORDINALITY key(output_key, position)
    ORDER BY (analytics_normalize_output_v1(output_key, analytics_output_value_v1(source.response_variables, output_key)) ->> 'status' = 'MISSING'), position LIMIT 1
  ) sentiment ON TRUE
  LEFT JOIN LATERAL (
    SELECT output_key,
      analytics_normalize_output_v1(output_key, analytics_output_value_v1(source.response_variables, output_key)) AS normalized
    FROM unnest(ARRAY['candidate_impression', 'candidate_sentiment', 'veeresh_impression', 'candidate_criterion_fit', 'veeresh_criterion_fit']) WITH ORDINALITY key(output_key, position)
    ORDER BY (analytics_normalize_output_v1(output_key, analytics_output_value_v1(source.response_variables, output_key)) ->> 'status' = 'MISSING'), position LIMIT 1
  ) assessment ON TRUE
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
  issue_source_key, party_source_key, leader_source_key, candidate_source_key,
  sentiment_source_key, assessment_source_key,
  sentiment_normalized ->> 'version' AS normalization_version
FROM normalized_rows;

COMMENT ON VIEW analytics_research_enterprise_v2 IS
  'Canonical aggregate-reporting dimensions with source keys and explicit missing/uncertain/refused/uncoded status. Raw answers remain only in privileged call records; no raw free text, voter names, contact identifiers or transcripts are exposed. Named parties do not imply vote choice.';

CREATE OR REPLACE VIEW analytics_iteration_movement_v2 AS
WITH signal AS (
  SELECT research.program_id, research.program_code, research.program_name,
    research.campaign_id, research.campaign_code, research.campaign_name,
    research.iteration_id, research.iteration_number, research.iteration_name,
    COUNT(DISTINCT respondent_key)::integer AS respondent_base,
    COUNT(DISTINCT respondent_key) FILTER (WHERE direct_party_strength IS NOT NULL)::integer AS direct_measure_base,
    ROUND(AVG(direct_party_strength), 2) AS average_direct_party_strength,
    COUNT(DISTINCT respondent_key) FILTER (WHERE issue_priority_status <> 'MISSING')::integer AS issue_response_base,
    COUNT(DISTINCT respondent_key) FILTER (WHERE respondent_sentiment_status <> 'MISSING')::integer AS sentiment_answer_base,
    COUNT(DISTINCT respondent_key) FILTER (WHERE respondent_sentiment_status = 'MISSING')::integer AS sentiment_missing_count,
    COUNT(DISTINCT respondent_key) FILTER (WHERE respondent_sentiment_status = 'UNCODED')::integer AS sentiment_uncoded_count,
    COUNT(DISTINCT respondent_key) FILTER (WHERE respondent_sentiment_status = 'CANT_SAY')::integer AS sentiment_cant_say_count,
    COUNT(DISTINCT respondent_key) FILTER (WHERE respondent_sentiment_status = 'REFUSED')::integer AS sentiment_refused_count,
    COUNT(DISTINCT respondent_key) FILTER (WHERE candidate_sentiment_status <> 'MISSING')::integer AS candidate_answer_base,
    COUNT(DISTINCT respondent_key) FILTER (WHERE candidate_sentiment_status = 'MISSING')::integer AS candidate_missing_count,
    COUNT(DISTINCT respondent_key) FILTER (WHERE candidate_sentiment_status = 'UNCODED')::integer AS candidate_uncoded_count,
    COUNT(DISTINCT respondent_key) FILTER (WHERE candidate_sentiment_status = 'CANT_SAY')::integer AS candidate_cant_say_count,
    COUNT(DISTINCT respondent_key) FILTER (WHERE candidate_sentiment_status = 'REFUSED')::integer AS candidate_refused_count,
    ROUND(100.0 * COUNT(DISTINCT respondent_key) FILTER (WHERE respondent_sentiment = 'Positive') /
      NULLIF(COUNT(DISTINCT respondent_key) FILTER (WHERE respondent_sentiment_status <> 'MISSING'), 0), 1) AS positive_sentiment_pct,
    ROUND(100.0 * COUNT(DISTINCT respondent_key) FILTER (WHERE respondent_sentiment = 'Negative') /
      NULLIF(COUNT(DISTINCT respondent_key) FILTER (WHERE respondent_sentiment_status <> 'MISSING'), 0), 1) AS negative_sentiment_pct,
    ROUND(100.0 * COUNT(DISTINCT respondent_key) FILTER (WHERE candidate_sentiment = 'Positive') /
      NULLIF(COUNT(DISTINCT respondent_key) FILTER (WHERE candidate_sentiment_status <> 'MISSING'), 0), 1) AS candidate_positive_pct
  FROM analytics_research_enterprise_v2 research
  GROUP BY research.program_id, research.program_code, research.program_name,
    research.campaign_id, research.campaign_code, research.campaign_name,
    research.iteration_id, research.iteration_number, research.iteration_name
), movement AS (
  SELECT signal.*,
    LAG(iteration_id) OVER wave_order AS previous_evidence_iteration_id,
    LAG(respondent_base) OVER wave_order AS previous_respondent_base,
    LAG(direct_measure_base) OVER wave_order AS previous_direct_measure_base,
    LAG(sentiment_answer_base) OVER wave_order AS previous_sentiment_answer_base,
    LAG(candidate_answer_base) OVER wave_order AS previous_candidate_answer_base,
    average_direct_party_strength - LAG(average_direct_party_strength) OVER wave_order AS unqualified_party_strength_change,
    positive_sentiment_pct - LAG(positive_sentiment_pct) OVER wave_order AS unqualified_positive_sentiment_change_pct,
    candidate_positive_pct - LAG(candidate_positive_pct) OVER wave_order AS unqualified_candidate_positive_change_pct
  FROM signal WINDOW wave_order AS (PARTITION BY campaign_id ORDER BY iteration_number)
), reportable AS (
  SELECT movement.*, gate.comparison_status, gate.comparison_reasons AS design_reasons,
    gate.previous_iteration_id,
    CASE WHEN respondent_base < 5 THEN 'SUPPRESSED'
      WHEN gate.comparison_status = 'BASELINE' THEN 'BASELINE'
      WHEN gate.comparison_status <> 'COMPARABLE' THEN 'NOT_COMPARABLE'
      WHEN previous_evidence_iteration_id IS DISTINCT FROM gate.previous_iteration_id THEN 'NOT_COMPARABLE'
      WHEN previous_respondent_base < 5 THEN 'SUPPRESSED'
      ELSE 'COMPARABLE' END AS movement_status
  FROM movement JOIN analytics_iteration_comparability_v1 gate ON gate.iteration_id = movement.iteration_id
)
SELECT program_id, program_code, program_name, campaign_id, campaign_code, campaign_name,
  iteration_id, iteration_number, iteration_name, respondent_base,
  CASE WHEN direct_measure_base >= 5 THEN average_direct_party_strength END AS average_direct_party_strength,
  direct_measure_base,
  CASE WHEN sentiment_answer_base >= 5 THEN positive_sentiment_pct END AS positive_sentiment_pct,
  CASE WHEN sentiment_answer_base >= 5 THEN negative_sentiment_pct END AS negative_sentiment_pct,
  CASE WHEN candidate_answer_base >= 5 THEN candidate_positive_pct END AS candidate_positive_pct,
  issue_response_base,
  CASE WHEN movement_status = 'COMPARABLE' AND direct_measure_base >= 5 AND previous_direct_measure_base >= 5
    THEN ROUND(unqualified_party_strength_change, 2) END AS party_strength_change,
  CASE WHEN movement_status = 'COMPARABLE' AND sentiment_answer_base >= 5 AND previous_sentiment_answer_base >= 5
    THEN ROUND(unqualified_positive_sentiment_change_pct, 1) END AS positive_sentiment_change_pct,
  CASE WHEN movement_status = 'COMPARABLE' AND candidate_answer_base >= 5 AND previous_candidate_answer_base >= 5
    THEN ROUND(unqualified_candidate_positive_change_pct, 1) END AS candidate_positive_change_pct,
  movement_status AS comparison_basis,
  'Recorded non-missing answers, including explicit uncertainty, refusals and uncoded responses; missing shown separately'::text AS percentage_basis,
  sentiment_answer_base, sentiment_missing_count, sentiment_uncoded_count, sentiment_cant_say_count, sentiment_refused_count,
  candidate_answer_base, candidate_missing_count, candidate_uncoded_count, candidate_cant_say_count, candidate_refused_count,
  previous_sentiment_answer_base, previous_candidate_answer_base,
  'Primary recorded civic/incumbent assessment: issue, development, change, then incumbent'::text AS sentiment_construct,
  'Candidate assessment: first recorded impression/sentiment, then criterion fit'::text AS candidate_construct,
  CASE WHEN movement_status = 'COMPARABLE' THEN 'Qualified adjacent-wave movement; measure-specific answer bases shown; not a causal effect'
    WHEN movement_status = 'BASELINE' THEN 'Baseline wave; no change available'
    ELSE 'Movement unavailable: consecutive comparable waves and measure-specific minimum answer bases required' END::text AS interpretation_label,
  ARRAY_REMOVE(design_reasons || ARRAY[
    CASE WHEN respondent_base < 5 OR previous_respondent_base < 5 THEN 'Fewer than five respondents in one or both waves' END,
    CASE WHEN comparison_status <> 'BASELINE' AND previous_evidence_iteration_id IS DISTINCT FROM previous_iteration_id
      THEN 'Previous Campaign Iteration has no reportable evidence; missing waves are not bridged' END,
    CASE WHEN direct_measure_base < 5 OR previous_direct_measure_base < 5 THEN 'Direct party-strength movement requires five answered direct measures in each wave' END,
    CASE WHEN sentiment_answer_base < 5 OR previous_sentiment_answer_base < 5 THEN 'Sentiment movement requires five non-missing answers in each wave' END,
    CASE WHEN candidate_answer_base < 5 OR previous_candidate_answer_base < 5 THEN 'Candidate movement requires five non-missing answers in each wave' END
  ], NULL)::text[] AS comparison_reasons
FROM reportable;

CREATE OR REPLACE VIEW analytics_research_geographic_v2 AS
WITH geographic_rollup AS (
  SELECT research.program_id, research.program_code, research.program_name,
    research.campaign_id, research.campaign_code, research.campaign_name,
    research.constituency_code, research.constituency_name,
    research.iteration_id, research.iteration_number, research.iteration_name,
    research.mandal_name, reference.state_name, reference.country_name,
    reference.latitude::double precision AS latitude, reference.longitude::double precision AS longitude,
    research.party_salience AS party_name, research.party_salience_status AS party_answer_status,
    COUNT(DISTINCT respondent_key)::integer AS respondent_count,
    COUNT(DISTINCT respondent_key) FILTER (WHERE direct_party_strength IS NOT NULL)::integer AS direct_measure_base,
    ROUND(AVG(direct_party_strength), 2) AS average_party_strength,
    COUNT(DISTINCT respondent_key) FILTER (WHERE respondent_sentiment = 'Positive')::integer AS positive_respondents,
    COUNT(DISTINCT respondent_key) FILTER (WHERE respondent_sentiment = 'Negative')::integer AS negative_respondents,
    COUNT(DISTINCT respondent_key) FILTER (WHERE respondent_sentiment_status = 'CANT_SAY')::integer AS uncertain_respondents
  FROM analytics_research_enterprise_v2 research
  JOIN analytics_geo_reference reference ON reference.geography_type = 'MANDAL' AND reference.is_active = TRUE
    AND reference.normalized_name = lower(regexp_replace(trim(research.mandal_name), '\s+', ' ', 'g'))
  GROUP BY research.program_id, research.program_code, research.program_name,
    research.campaign_id, research.campaign_code, research.campaign_name,
    research.constituency_code, research.constituency_name, research.iteration_id,
    research.iteration_number, research.iteration_name, research.mandal_name,
    reference.state_name, reference.country_name, reference.latitude, reference.longitude,
    research.party_salience, research.party_salience_status
)
SELECT program_id, program_code, program_name, campaign_id, campaign_code, campaign_name,
  constituency_code, constituency_name, iteration_id, iteration_number, iteration_name,
  mandal_name, state_name, country_name, latitude, longitude, party_name, respondent_count,
  CASE WHEN direct_measure_base >= 5 THEN average_party_strength END AS average_party_strength,
  positive_respondents, negative_respondents, uncertain_respondents,
  respondent_count::numeric AS heat_weight,
  CASE WHEN direct_measure_base >= 5 THEN average_party_strength END AS party_pulse_score,
  'Recorded party salience only; not vote choice or an election forecast'::text AS interpretation_label,
  party_answer_status, direct_measure_base
FROM geographic_rollup WHERE respondent_count >= 5;

COMMIT;
