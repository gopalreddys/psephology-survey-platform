-- No cascading source FK: historical attestations survive source retirement.
CREATE TABLE IF NOT EXISTS call_quality_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id uuid NOT NULL,
  campaign_id uuid NOT NULL,
  iteration_id uuid NOT NULL,
  run_id uuid NOT NULL,
  actor_user_id uuid NOT NULL,
  evidence_fingerprint text NOT NULL CHECK (evidence_fingerprint ~ '^[a-f0-9]{64}$'),
  language text NOT NULL CHECK (language IN ('TELUGU','ENGLISH','HINDI','MIXED','OTHER')),
  checks jsonb NOT NULL CHECK (jsonb_typeof(checks) = 'object'
    AND checks ?& ARRAY['greetingFlow','questionDelivery','languageHandling','neutrality','outputExtraction','missingStateHandling']
    AND (checks - ARRAY['greetingFlow','questionDelivery','languageHandling','neutrality','outputExtraction','missingStateHandling']) = '{}'::jsonb
    AND jsonb_typeof(checks->'greetingFlow') = 'string'
    AND jsonb_typeof(checks->'questionDelivery') = 'string'
    AND jsonb_typeof(checks->'languageHandling') = 'string'
    AND jsonb_typeof(checks->'neutrality') = 'string'
    AND jsonb_typeof(checks->'outputExtraction') = 'string'
    AND jsonb_typeof(checks->'missingStateHandling') = 'string'
    AND checks->>'greetingFlow' IN ('PASS','FAIL','NOT_ASSESSABLE')
    AND checks->>'questionDelivery' IN ('PASS','FAIL','NOT_ASSESSABLE')
    AND checks->>'languageHandling' IN ('PASS','FAIL','NOT_ASSESSABLE')
    AND checks->>'neutrality' IN ('PASS','FAIL','NOT_ASSESSABLE')
    AND checks->>'outputExtraction' IN ('PASS','FAIL','NOT_ASSESSABLE')
    AND checks->>'missingStateHandling' IN ('PASS','FAIL','NOT_ASSESSABLE')),
  issue_buckets text[] NOT NULL DEFAULT '{}' CHECK (issue_buckets <@ ARRAY[
    'GREETING_LOOP','QUESTION_SKIPPED','LANGUAGE_HANDLING','OUTPUT_MISMATCH',
    'MISSING_STATE_ERROR','LEADING_QUESTION','OTHER']::text[]),
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 1000),
  attested boolean NOT NULL CHECK (attested),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (execution_id, evidence_fingerprint, actor_user_id)
);

CREATE TABLE IF NOT EXISTS call_quality_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id uuid NOT NULL,
  campaign_id uuid NOT NULL,
  iteration_id uuid NOT NULL,
  run_id uuid NOT NULL,
  actor_user_id uuid NOT NULL,
  evidence_fingerprint text NOT NULL CHECK (evidence_fingerprint ~ '^[a-f0-9]{64}$'),
  revision integer NOT NULL CHECK (revision > 0),
  action text NOT NULL CHECK (action IN ('APPROVE_SAMPLE','REJECT_SAMPLE')),
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 1000),
  attested boolean NOT NULL CHECK (attested),
  decided_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (execution_id, revision)
);

CREATE INDEX IF NOT EXISTS call_quality_reviews_scope_idx ON call_quality_reviews (campaign_id, iteration_id, execution_id);
CREATE INDEX IF NOT EXISTS call_quality_decisions_scope_idx ON call_quality_decisions (campaign_id, iteration_id, execution_id, revision DESC);

CREATE OR REPLACE FUNCTION reject_call_quality_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Call quality audit is append-only' USING ERRCODE = '55000';
END;
$$;
DROP TRIGGER IF EXISTS call_quality_reviews_immutable ON call_quality_reviews;
CREATE TRIGGER call_quality_reviews_immutable BEFORE UPDATE OR DELETE ON call_quality_reviews
  FOR EACH ROW EXECUTE FUNCTION reject_call_quality_audit_mutation();
DROP TRIGGER IF EXISTS call_quality_reviews_no_truncate ON call_quality_reviews;
CREATE TRIGGER call_quality_reviews_no_truncate BEFORE TRUNCATE ON call_quality_reviews
  FOR EACH STATEMENT EXECUTE FUNCTION reject_call_quality_audit_mutation();
DROP TRIGGER IF EXISTS call_quality_decisions_immutable ON call_quality_decisions;
CREATE TRIGGER call_quality_decisions_immutable BEFORE UPDATE OR DELETE ON call_quality_decisions
  FOR EACH ROW EXECUTE FUNCTION reject_call_quality_audit_mutation();
DROP TRIGGER IF EXISTS call_quality_decisions_no_truncate ON call_quality_decisions;
CREATE TRIGGER call_quality_decisions_no_truncate BEFORE TRUNCATE ON call_quality_decisions
  FOR EACH STATEMENT EXECUTE FUNCTION reject_call_quality_audit_mutation();
REVOKE UPDATE, DELETE, TRUNCATE ON call_quality_reviews, call_quality_decisions FROM PUBLIC;
