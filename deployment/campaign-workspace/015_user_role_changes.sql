BEGIN;

CREATE TABLE IF NOT EXISTS user_role_change_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  target_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  previous_role_code text NOT NULL,
  new_role_code text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_role_change_audit_target
  ON user_role_change_audit(target_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_role_change_audit_actor
  ON user_role_change_audit(actor_user_id, created_at DESC);

COMMIT;
