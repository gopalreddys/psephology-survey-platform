BEGIN;

ALTER TABLE voter_demo_calls
  ADD COLUMN IF NOT EXISTS interaction_id text,
  ADD COLUMN IF NOT EXISTS provider_status text,
  ADD COLUMN IF NOT EXISTS disposition text,
  ADD COLUMN IF NOT EXISTS goal_status text,
  ADD COLUMN IF NOT EXISTS duration_seconds numeric,
  ADD COLUMN IF NOT EXISTS transcript_turns integer,
  ADD COLUMN IF NOT EXISTS final_agent_variables jsonb,
  ADD COLUMN IF NOT EXISTS callback_payload jsonb,
  ADD COLUMN IF NOT EXISTS callback_received_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_voter_demo_calls_provider_call
  ON voter_demo_calls (provider_call_id)
  WHERE provider_call_id IS NOT NULL;

COMMENT ON COLUMN voter_demo_calls.goal_status IS
  'Provider goal evaluation is retained separately from the platform operational status.';

COMMENT ON COLUMN voter_demo_calls.final_agent_variables IS
  'Structured provider output retained for controlled demo-call diagnostics; excluded from research analytics.';

COMMIT;
