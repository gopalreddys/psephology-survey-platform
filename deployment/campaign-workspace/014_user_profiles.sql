BEGIN;

CREATE TABLE IF NOT EXISTS user_profiles (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  photo_object_key text,
  photo_content_type text,
  photo_uploaded_at timestamptz,
  address_line_1 text,
  address_line_2 text,
  village_name text,
  mandal_name text,
  district_name text,
  state_name text,
  postal_code text,
  govt_id_type text,
  govt_id_last4 text,
  govt_id_object_key text,
  govt_id_uploaded_at timestamptz,
  govt_id_verified boolean NOT NULL DEFAULT FALSE,
  govt_id_verified_by uuid REFERENCES users(id) ON DELETE SET NULL,
  govt_id_verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT user_profiles_postal_code_length CHECK (postal_code IS NULL OR char_length(postal_code) BETWEEN 3 AND 12),
  CONSTRAINT user_profiles_govt_id_last4 CHECK (govt_id_last4 IS NULL OR govt_id_last4 ~ '^[0-9A-Za-z]{4}$')
);

CREATE INDEX IF NOT EXISTS idx_user_profiles_district
  ON user_profiles(district_name);

CREATE TABLE IF NOT EXISTS user_profile_access_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  target_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('VIEW', 'UPDATE', 'VIEW_GOVT_ID', 'UPDATE_GOVT_ID')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_profile_audit_target
  ON user_profile_access_audit(target_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_profile_audit_actor
  ON user_profile_access_audit(actor_user_id, created_at DESC);

COMMIT;
