BEGIN;

CREATE OR REPLACE VIEW analytics_research_enterprise_v1 AS
WITH latest_connected_evidence AS (
  SELECT DISTINCT ON (
    link.campaign_id,
    call_record.iteration_id,
    COALESCE(call_record.voter_id, call_record.id)
  )
    link.campaign_id,
    call_record.iteration_id,
    call_record.run_id,
    call_record.id AS call_id,
    call_record.voter_id,
    call_record.response_variables,
    call_record.duration_seconds,
    call_record.updated_at AS response_recorded_at
  FROM campaign_iteration_links link
  JOIN calls call_record ON call_record.iteration_id = link.iteration_id
  WHERE LOWER(COALESCE(call_record.connectivity_status, '')) = 'connected'
    AND jsonb_typeof(call_record.response_variables) = 'object'
    AND call_record.response_variables <> '{}'::jsonb
  ORDER BY link.campaign_id, call_record.iteration_id,
    COALESCE(call_record.voter_id, call_record.id),
    call_record.updated_at DESC NULLS LAST
), reporting_rows AS (
  SELECT
    program.id AS program_id,
    program.study_code AS program_code,
    program.study_name AS program_name,
    campaign.id AS campaign_id,
    campaign.campaign_code,
    campaign.campaign_name,
    campaign.status AS campaign_status,
    campaign.survey_stage,
    campaign.target_type,
    campaign.target_code AS constituency_code,
    COALESCE(voter.assembly_constituency_name, campaign.target_name) AS constituency_name,
    campaign.campaign_manager_user_id,
    campaign.created_by_user_id,
    iteration.id AS iteration_id,
    iteration.iteration_number,
    iteration.iteration_name,
    COALESCE(link.status, iteration.status) AS iteration_status,
    run.id AS run_id,
    run.run_number,
    run.run_name,
    run.status AS run_status,
    MD5(COALESCE(evidence.voter_id::text, evidence.call_id::text)) AS respondent_key,
    CASE
      WHEN LOWER(TRIM(COALESCE(voter.gender, ''))) IN ('f', 'female', 'woman') THEN 'Female'
      WHEN LOWER(TRIM(COALESCE(voter.gender, ''))) IN ('m', 'male', 'man') THEN 'Male'
      WHEN TRIM(COALESCE(voter.gender, '')) = '' THEN 'Unknown'
      ELSE 'Other / self-described'
    END AS gender,
    voter.age,
    CASE
      WHEN voter.age BETWEEN 18 AND 29 THEN '18–29'
      WHEN voter.age BETWEEN 30 AND 39 THEN '30–39'
      WHEN voter.age BETWEEN 40 AND 49 THEN '40–49'
      WHEN voter.age >= 50 THEN '50+'
      ELSE 'Unknown'
    END AS age_band,
    COALESCE(NULLIF(TRIM(voter.mandal_name_source), ''), 'Unknown') AS mandal_name,
    evidence.duration_seconds,
    evidence.response_recorded_at,
    NULLIF(TRIM(evidence.response_variables ->> 'graduate_issue_priority'), '') AS issue_priority,
    NULLIF(TRIM(evidence.response_variables ->> 'issue_sentiment'), '') AS issue_sentiment,
    NULLIF(TRIM(evidence.response_variables ->> 'development_sentiment'), '') AS development_sentiment,
    NULLIF(TRIM(evidence.response_variables ->> 'change_sentiment'), '') AS change_sentiment,
    NULLIF(TRIM(evidence.response_variables ->> 'party_salience_unaided'), '') AS party_salience,
    NULLIF(TRIM(COALESCE(
      evidence.response_variables ->> 'perceived_issue_leader_aided',
      evidence.response_variables ->> 'perceived_issue_leader',
      evidence.response_variables ->> 'leadership_preference'
    )), '') AS party_leadership,
    COALESCE(
      NULLIF(TRIM(evidence.response_variables ->> 'candidate_name'), ''),
      NULLIF(TRIM(evidence.response_variables ->> 'candidate_reference'), ''),
      CASE WHEN evidence.response_variables ?| ARRAY[
        'veeresh_awareness', 'veeresh_impression', 'veeresh_criterion_fit'
      ] THEN 'Kasani Veeresh' END
    ) AS candidate_name,
    NULLIF(TRIM(COALESCE(
      evidence.response_variables ->> 'candidate_awareness',
      evidence.response_variables ->> 'veeresh_awareness'
    )), '') AS candidate_awareness,
    NULLIF(TRIM(COALESCE(
      evidence.response_variables ->> 'candidate_impression',
      evidence.response_variables ->> 'candidate_sentiment',
      evidence.response_variables ->> 'veeresh_impression'
    )), '') AS candidate_perception,
    NULLIF(TRIM(COALESCE(
      evidence.response_variables ->> 'candidate_criterion_fit',
      evidence.response_variables ->> 'veeresh_criterion_fit'
    )), '') AS candidate_fit,
    NULLIF(TRIM(evidence.response_variables ->> 'incumbent_assessment'), '') AS incumbent_assessment,
    NULLIF(TRIM(evidence.response_variables ->> 'association_influence'), '') AS association_influence,
    COALESCE(
      NULLIF(TRIM(evidence.response_variables ->> 'party_lean_rating'), ''),
      NULLIF(TRIM(evidence.response_variables ->> 'party_lean_strength'), ''),
      NULLIF(TRIM(evidence.response_variables ->> 'brs_lean_rating'), '')
    ) AS party_strength_raw
  FROM latest_connected_evidence evidence
  JOIN campaign_iteration_links link
    ON link.campaign_id = evidence.campaign_id
   AND link.iteration_id = evidence.iteration_id
  JOIN campaigns campaign ON campaign.id = evidence.campaign_id
  LEFT JOIN survey_studies program ON program.id = campaign.program_id
  JOIN program_iterations iteration ON iteration.id = evidence.iteration_id
  LEFT JOIN campaign_runs run ON run.id = evidence.run_id
  LEFT JOIN voter_master voter ON voter.id = evidence.voter_id
  WHERE campaign.status <> 'ARCHIVED'
)
SELECT reporting_rows.*,
  CASE
    WHEN party_strength_raw ~ '^[1-5]([.][0-9]+)?$'
      THEN LEAST(GREATEST(party_strength_raw::numeric, 1), 5)
    ELSE NULL
  END AS direct_party_strength,
  CASE
    WHEN LOWER(CONCAT_WS(' ', candidate_perception, candidate_fit)) ~
      'not enough|don.?t know|do not know|can.?t say|cannot say|no opinion|not aware|unclear|unknown'
      THEN 'Uncertain'
    WHEN LOWER(CONCAT_WS(' ', candidate_perception, candidate_fit)) ~
      'very poor|poor|negative|bad|dissatisf|disappoint|not good|unfavour|unfavor|weak|poor fit'
      THEN 'Negative'
    WHEN LOWER(CONCAT_WS(' ', candidate_perception, candidate_fit)) ~
      'neither|neutral|mixed|average|no difference|okay|moderate'
      THEN 'Neutral'
    WHEN LOWER(CONCAT_WS(' ', candidate_perception, candidate_fit)) ~
      'very good|good|positive|favour|favor|satisf|impress|excellent|strong|good fit'
      THEN 'Positive'
    WHEN COALESCE(candidate_perception, candidate_fit) IS NOT NULL THEN 'Uncertain'
    ELSE NULL
  END AS candidate_sentiment,
  CASE
    WHEN LOWER(CONCAT_WS(' ', issue_sentiment, development_sentiment,
      change_sentiment, incumbent_assessment)) ~
      'very poor|poor|negative|bad|dissatisf|disappoint|not good|unfavour|unfavor|weak'
      THEN 'Negative'
    WHEN LOWER(CONCAT_WS(' ', issue_sentiment, development_sentiment,
      change_sentiment, incumbent_assessment)) ~
      'very good|good|positive|favour|favor|satisf|impress|excellent|strong'
      THEN 'Positive'
    WHEN LOWER(CONCAT_WS(' ', issue_sentiment, development_sentiment,
      change_sentiment, incumbent_assessment)) ~
      'neither|neutral|mixed|average|no difference|okay|moderate'
      THEN 'Neutral'
    WHEN COALESCE(issue_sentiment, development_sentiment,
      change_sentiment, incumbent_assessment) IS NOT NULL THEN 'Uncertain'
    ELSE NULL
  END AS respondent_sentiment
FROM reporting_rows;

COMMENT ON VIEW analytics_research_enterprise_v1 IS
  'Non-PII respondent-level research facts for governed Amazon Quick Sight dashboards. Names, phone numbers, EPIC IDs, transcripts and raw JSON are excluded.';

COMMIT;
