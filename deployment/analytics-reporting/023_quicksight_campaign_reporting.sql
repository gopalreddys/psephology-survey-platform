CREATE OR REPLACE VIEW analytics_campaign_run_dashboard_v1 AS
WITH contact_stats AS (
  SELECT run_id,
    COUNT(DISTINCT voter_id)::int AS contact_placements,
    COUNT(DISTINCT voter_id) FILTER (
      WHERE final_status IN ('SUCCESS_PULSE', 'SUCCESS_COMPLETE', 'SUCCESS_SUBSTANTIAL')
    )::int AS successful_contacts,
    COUNT(DISTINCT voter_id) FILTER (
      WHERE retry_eligible = TRUE AND retry_exhausted = FALSE
    )::int AS retry_eligible_contacts,
    COUNT(DISTINCT voter_id) FILTER (
      WHERE attempt_status NOT IN ('COMPLETED', 'FAILED')
    )::int AS pending_contacts
  FROM campaign_run_contacts
  GROUP BY run_id
), execution_stats AS (
  SELECT run_id,
    COUNT(*)::int AS call_attempts,
    COUNT(*) FILTER (WHERE callback_received_at IS NOT NULL)::int AS callbacks_received,
    COUNT(*) FILTER (
      WHERE callback_received_at IS NULL
        AND status IN ('PENDING', 'SUBMITTED', 'RUNNING')
    )::int AS awaiting_callbacks
  FROM call_executions
  GROUP BY run_id
), evidence_stats AS (
  SELECT run_id,
    COUNT(*) FILTER (
      WHERE LOWER(COALESCE(connectivity_status, '')) = 'connected'
    )::int AS connected_calls,
    COUNT(*) FILTER (
      WHERE LOWER(COALESCE(connectivity_status, '')) = 'connected'
        AND jsonb_typeof(interaction_transcript) = 'array'
        AND jsonb_array_length(interaction_transcript) > 0
    )::int AS transcripts_captured,
    COUNT(*) FILTER (
      WHERE LOWER(COALESCE(connectivity_status, '')) = 'connected'
        AND jsonb_typeof(response_variables) = 'object'
        AND response_variables <> '{}'::jsonb
    )::int AS responses_captured,
    ROUND(AVG(duration_seconds) FILTER (
      WHERE LOWER(COALESCE(connectivity_status, '')) = 'connected'
    )::numeric, 1) AS average_duration_seconds
  FROM calls
  GROUP BY run_id
)
SELECT
  campaign.id AS campaign_id,
  campaign.campaign_code,
  campaign.campaign_name,
  campaign.status AS campaign_status,
  campaign.survey_stage,
  campaign.campaign_manager_user_id,
  iteration.id AS iteration_id,
  iteration.iteration_number,
  iteration.iteration_name,
  COALESCE(link.status, iteration.status) AS iteration_status,
  iteration.questionnaire_id,
  iteration.voice_agent_id,
  run.id AS run_id,
  run.run_number,
  run.run_name,
  run.status AS run_status,
  run.created_at AS run_created_at,
  run.updated_at AS run_updated_at,
  COALESCE(contact.contact_placements, 0)::int AS contact_placements,
  COALESCE(contact.successful_contacts, 0)::int AS successful_contacts,
  COALESCE(contact.retry_eligible_contacts, 0)::int AS retry_eligible_contacts,
  COALESCE(contact.pending_contacts, 0)::int AS pending_contacts,
  COALESCE(execution.call_attempts, 0)::int AS call_attempts,
  COALESCE(execution.callbacks_received, 0)::int AS callbacks_received,
  COALESCE(execution.awaiting_callbacks, 0)::int AS awaiting_callbacks,
  COALESCE(evidence.connected_calls, 0)::int AS connected_calls,
  COALESCE(evidence.transcripts_captured, 0)::int AS transcripts_captured,
  COALESCE(evidence.responses_captured, 0)::int AS responses_captured,
  COALESCE(evidence.average_duration_seconds, 0)::numeric AS average_duration_seconds,
  CASE WHEN COALESCE(execution.call_attempts, 0) = 0 THEN 0
    ELSE ROUND((COALESCE(evidence.connected_calls, 0)::numeric / execution.call_attempts) * 100, 1)
  END AS connection_rate_pct,
  CASE WHEN COALESCE(evidence.connected_calls, 0) = 0 THEN 0
    ELSE ROUND((COALESCE(evidence.transcripts_captured, 0)::numeric / evidence.connected_calls) * 100, 1)
  END AS transcript_coverage_pct,
  CASE WHEN COALESCE(evidence.connected_calls, 0) = 0 THEN 0
    ELSE ROUND((COALESCE(evidence.responses_captured, 0)::numeric / evidence.connected_calls) * 100, 1)
  END AS response_coverage_pct
FROM campaign_runs run
JOIN program_iterations iteration ON iteration.id = run.iteration_id
JOIN campaign_iteration_links link ON link.iteration_id = iteration.id
JOIN campaigns campaign ON campaign.id = link.campaign_id
LEFT JOIN contact_stats contact ON contact.run_id = run.id
LEFT JOIN execution_stats execution ON execution.run_id = run.id
LEFT JOIN evidence_stats evidence ON evidence.run_id = run.id
WHERE campaign.status <> 'ARCHIVED';

COMMENT ON VIEW analytics_campaign_run_dashboard_v1 IS
  'Aggregate, non-PII campaign execution and evidence measures for governed BI datasets.';
