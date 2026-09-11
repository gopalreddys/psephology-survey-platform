BEGIN;

ALTER TABLE calls
  ADD COLUMN IF NOT EXISTS interaction_transcript jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS response_variables jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE call_executions
  ADD COLUMN IF NOT EXISTS callback_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS callback_received_at timestamp with time zone;

ALTER TABLE survey_responses
  ADD COLUMN IF NOT EXISTS source_call_id uuid,
  ADD COLUMN IF NOT EXISTS source_variable_key text,
  ADD COLUMN IF NOT EXISTS response_source text;

CREATE UNIQUE INDEX IF NOT EXISTS survey_responses_provider_variable_uq
  ON survey_responses (source_call_id, source_variable_key)
  WHERE source_call_id IS NOT NULL
    AND source_variable_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS sarvam_outbound_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id text NOT NULL,
  event_hash text NOT NULL UNIQUE,
  delivery_status text NOT NULL DEFAULT 'RECEIVED',
  raw_payload jsonb NOT NULL,
  error_message text,
  received_at timestamp with time zone NOT NULL DEFAULT now(),
  processed_at timestamp with time zone
);

CREATE INDEX IF NOT EXISTS sarvam_outbound_webhook_attempt_idx
  ON sarvam_outbound_webhook_events (attempt_id, received_at DESC);

COMMIT;
