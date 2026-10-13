BEGIN;

-- Additive consistency correction. Historical instruments and answers are not rewritten.
CREATE OR REPLACE FUNCTION analytics_direct_rating_v1(response_values jsonb)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE AS $direct_rating$
DECLARE item record; current_value numeric; selected_value numeric;
BEGIN
 IF jsonb_typeof(response_values) IS DISTINCT FROM 'object' THEN RETURN NULL; END IF;
 FOR item IN SELECT key, value FROM jsonb_each(response_values)
   WHERE lower(btrim(key, U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')) = ANY(ARRAY['brs_lean_rating','party_lean_rating','party_lean_strength']) LOOP
   IF item.value = 'null'::jsonb OR (jsonb_typeof(item.value) = 'string' AND btrim(item.value #>> '{}', U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF') = '') THEN CONTINUE; END IF;
   IF jsonb_typeof(item.value) = 'string' AND btrim(item.value #>> '{}', U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF') !~ '^[1-5]$' THEN RETURN NULL; END IF;
   IF jsonb_typeof(item.value) NOT IN ('string','number') THEN RETURN NULL; END IF;
   current_value := btrim(item.value #>> '{}', U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')::numeric;
   IF current_value <> trunc(current_value) OR current_value < 1 OR current_value > 5 THEN RETURN NULL; END IF;
   IF selected_value IS NOT NULL AND selected_value <> current_value THEN RETURN NULL; END IF;
   selected_value := current_value;
 END LOOP;
 RETURN selected_value;
END;
$direct_rating$;
CREATE OR REPLACE FUNCTION analytics_direct_rating_status_v1(response_values jsonb)
RETURNS text LANGUAGE sql IMMUTABLE AS $direct_status$
 SELECT CASE WHEN analytics_direct_rating_v1(response_values) IS NOT NULL THEN 'RECORDED'
   WHEN EXISTS (SELECT 1 FROM jsonb_each(CASE WHEN jsonb_typeof(response_values)='object' THEN response_values ELSE '{}'::jsonb END) item
     WHERE lower(btrim(item.key, U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'))=ANY(ARRAY['brs_lean_rating','party_lean_rating','party_lean_strength'])
       AND item.value <> 'null'::jsonb
       AND NOT (jsonb_typeof(item.value)='string' AND btrim(item.value #>> '{}', U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')='')) THEN 'UNRESOLVED'
   ELSE 'MISSING' END;
$direct_status$;

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
  analytics_direct_rating_v1(response_variables) AS direct_party_strength,
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
  sentiment_normalized ->> 'version' AS normalization_version,
  'CURRENT_MASTER_DATA'::text AS demographic_provenance,
  analytics_direct_rating_status_v1(response_variables) AS direct_rating_status
FROM normalized_rows;


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
    research.party_salience, research.party_salience_status) ,
protected_rollup AS (SELECT geographic_rollup.*, MIN(respondent_count) OVER (PARTITION BY program_id, campaign_id, iteration_id, constituency_code, mandal_name) AS partition_minimum FROM geographic_rollup)
SELECT program_id, program_code, program_name, campaign_id, campaign_code, campaign_name,
  constituency_code, constituency_name, iteration_id, iteration_number, iteration_name,
  mandal_name, state_name, country_name, latitude, longitude, party_name, respondent_count,
  NULL::numeric AS average_party_strength,
  NULL::integer AS positive_respondents, NULL::integer AS negative_respondents, NULL::integer AS uncertain_respondents,
  respondent_count::numeric AS heat_weight,
  NULL::numeric AS party_pulse_score,
  'Recorded party salience only; not vote choice or an election forecast'::text AS interpretation_label,
  party_answer_status, NULL::integer AS direct_measure_base
FROM protected_rollup WHERE partition_minimum >= 5;


-- Protect movement denominators and both waves, not just the visible change.
CREATE OR REPLACE FUNCTION analytics_construct_partition_reportable_v1(scope_campaign uuid, scope_iteration uuid, construct text)
RETURNS boolean LANGUAGE sql STABLE AS $partition$
  WITH labels AS (SELECT respondent_key, CASE construct
    WHEN 'incumbent' THEN respondent_sentiment WHEN 'candidate' THEN candidate_sentiment
    WHEN 'direct' THEN COALESCE(direct_party_strength::text, direct_rating_status) END AS label
    FROM analytics_research_enterprise_v2 WHERE campaign_id=scope_campaign AND iteration_id=scope_iteration),
  cells AS (SELECT label, COUNT(DISTINCT respondent_key) AS people FROM labels GROUP BY label)
  SELECT COALESCE(MIN(people)>=5, FALSE)
    AND (construct <> 'direct' OR COALESCE(SUM(people) FILTER (WHERE label IN ('1','2','3','4','5')),0)>=5) FROM cells;
$partition$;
DO $movement_privacy$
DECLARE definition text; projection text;
BEGIN
  definition := pg_get_viewdef('analytics_iteration_movement_v2'::regclass, TRUE);
  IF position('reporting_partition_guards' IN definition)>0 THEN RETURN; END IF;
  SELECT string_agg(CASE
    WHEN attribute.attname IN ('previous_sentiment_answer_base') THEN format('CASE WHEN prior_incumbent_safe THEN source.%I END AS %I', attribute.attname, attribute.attname)
    WHEN attribute.attname IN ('previous_candidate_answer_base') THEN format('CASE WHEN prior_candidate_safe THEN source.%I END AS %I', attribute.attname, attribute.attname)
    WHEN attribute.attname IN ('positive_sentiment_change_pct') THEN format('CASE WHEN incumbent_safe AND prior_incumbent_safe THEN source.%I END AS %I', attribute.attname, attribute.attname)
    WHEN attribute.attname IN ('candidate_positive_change_pct') THEN format('CASE WHEN candidate_safe AND prior_candidate_safe THEN source.%I END AS %I', attribute.attname, attribute.attname)
    WHEN attribute.attname IN ('party_strength_change') THEN format('CASE WHEN direct_safe AND prior_direct_safe THEN source.%I END AS %I', attribute.attname, attribute.attname)
    WHEN attribute.attname IN ('sentiment_answer_base','sentiment_missing_count','sentiment_uncoded_count','sentiment_cant_say_count','sentiment_refused_count','positive_sentiment_pct','negative_sentiment_pct') THEN format('CASE WHEN incumbent_safe THEN source.%I END AS %I', attribute.attname, attribute.attname)
    WHEN attribute.attname IN ('candidate_answer_base','candidate_missing_count','candidate_uncoded_count','candidate_cant_say_count','candidate_refused_count','candidate_positive_pct') THEN format('CASE WHEN candidate_safe THEN source.%I END AS %I', attribute.attname, attribute.attname)
    WHEN attribute.attname IN ('direct_measure_base','average_direct_party_strength') THEN format('CASE WHEN direct_safe THEN source.%I END AS %I', attribute.attname, attribute.attname)
    WHEN attribute.attname IN ('respondent_base','issue_response_base') THEN format('CASE WHEN incumbent_safe AND candidate_safe AND direct_safe THEN source.%I END AS %I', attribute.attname, attribute.attname)
    ELSE format('source.%I', attribute.attname) END, ', ' ORDER BY attribute.attnum)
  INTO projection FROM pg_attribute attribute WHERE attribute.attrelid='analytics_iteration_movement_v2'::regclass AND attribute.attnum>0 AND NOT attribute.attisdropped;
  -- Count all construct partitions once and join the selected/prior waves.
  -- Avoid six correlated full evidence scans for every movement row.
  EXECUTE format('CREATE OR REPLACE VIEW analytics_iteration_movement_v2 AS WITH reviewed_source AS (%s),
    reporting_partition_cells AS (
      SELECT research.campaign_id, research.iteration_id, labels.construct, labels.label,
        COUNT(DISTINCT research.respondent_key) AS people
      FROM analytics_research_enterprise_v2 research
      CROSS JOIN LATERAL (VALUES (''incumbent'', research.respondent_sentiment),
        (''candidate'', research.candidate_sentiment),
        (''direct'', COALESCE(research.direct_party_strength::text, research.direct_rating_status))) labels(construct,label)
      GROUP BY research.campaign_id,research.iteration_id,labels.construct,labels.label),
    reporting_construct_guards AS (
      SELECT campaign_id, iteration_id, construct, MIN(people)>=5 AS partition_safe,
        SUM(people) FILTER (WHERE label IN (''1'',''2'',''3'',''4'',''5'')) AS direct_base
      FROM reporting_partition_cells GROUP BY campaign_id,iteration_id,construct),
    reporting_partition_guards AS (
      SELECT campaign_id,iteration_id,
        BOOL_AND(partition_safe) FILTER (WHERE construct=''incumbent'') AS incumbent_safe,
        BOOL_AND(partition_safe) FILTER (WHERE construct=''candidate'') AS candidate_safe,
        BOOL_AND(partition_safe AND COALESCE(direct_base,0)>=5) FILTER (WHERE construct=''direct'') AS direct_safe
      FROM reporting_construct_guards GROUP BY campaign_id,iteration_id), protected AS (
      SELECT source.*, COALESCE(current_guard.incumbent_safe,FALSE) AS incumbent_safe,
        COALESCE(current_guard.candidate_safe,FALSE) AS candidate_safe,
        COALESCE(current_guard.direct_safe,FALSE) AS direct_safe,
        COALESCE(prior_guard.incumbent_safe,FALSE) AS prior_incumbent_safe,
        COALESCE(prior_guard.candidate_safe,FALSE) AS prior_candidate_safe,
        COALESCE(prior_guard.direct_safe,FALSE) AS prior_direct_safe
      FROM reviewed_source source JOIN analytics_iteration_comparability_v1 gate ON gate.iteration_id=source.iteration_id
      LEFT JOIN reporting_partition_guards current_guard ON current_guard.campaign_id=source.campaign_id AND current_guard.iteration_id=source.iteration_id
      LEFT JOIN reporting_partition_guards prior_guard ON prior_guard.campaign_id=source.campaign_id AND prior_guard.iteration_id=gate.previous_iteration_id)
    SELECT %s FROM protected source', rtrim(definition, E';\n '), projection);
END;
$movement_privacy$;

COMMIT;
