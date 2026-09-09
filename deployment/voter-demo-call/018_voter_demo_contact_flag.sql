BEGIN;

ALTER TABLE voter_master
  ADD COLUMN IF NOT EXISTS is_demo_contact boolean NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS voter_demo_contact_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  voter_id uuid NOT NULL REFERENCES voter_master(id) ON DELETE RESTRICT,
  changed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  previous_value boolean NOT NULL,
  new_value boolean NOT NULL,
  reason text NOT NULL CHECK (length(trim(reason)) >= 5),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_voter_demo_contact_audit_voter_created
  ON voter_demo_contact_audit (voter_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_voter_master_demo_contacts
  ON voter_master (id)
  WHERE is_demo_contact = TRUE;

COMMENT ON COLUMN voter_master.is_demo_contact IS
  'Explicit allow-list for consented demonstration calls. Defaults to false and is enforced by the API.';

COMMENT ON TABLE voter_demo_contact_audit IS
  'Audit trail for changes to the voter demonstration-call allow-list.';

COMMIT;
