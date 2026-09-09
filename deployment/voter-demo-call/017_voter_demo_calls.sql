BEGIN;

CREATE TABLE IF NOT EXISTS voter_demo_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  voter_id uuid NOT NULL REFERENCES voter_master(id) ON DELETE RESTRICT,
  requested_by uuid REFERENCES users(id) ON DELETE SET NULL,
  idempotency_key text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'QUEUED'
    CHECK (status IN ('QUEUED', 'SUBMITTING', 'SUBMITTED', 'FAILED', 'COMPLETED', 'CANCELLED')),
  consent_confirmed boolean NOT NULL
    CHECK (consent_confirmed = TRUE),
  analytics_excluded boolean NOT NULL DEFAULT TRUE
    CHECK (analytics_excluded = TRUE),
  preferred_language_snapshot text,
  provider_call_id text,
  error_code text,
  error_message text,
  submitted_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_voter_demo_calls_voter_created
  ON voter_demo_calls (voter_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_voter_demo_calls_status
  ON voter_demo_calls (status, created_at DESC);

COMMENT ON TABLE voter_demo_calls IS
  'Audited, consent-confirmed demonstration calls. These rows are excluded from Program, Campaign, Iteration, Run and research analytics.';

COMMENT ON COLUMN voter_demo_calls.analytics_excluded IS
  'Hard guard requiring demonstration activity to remain outside production research metrics.';

COMMIT;
