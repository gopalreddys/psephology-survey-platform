BEGIN;

CREATE TABLE IF NOT EXISTS campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_code text NOT NULL UNIQUE,
  campaign_name text NOT NULL,
  program_id uuid,
  target_type text NOT NULL CHECK (target_type IN ('MP', 'MLA', 'MLC', 'ADMINISTRATIVE', 'LOCAL_BODY')),
  jurisdiction_id uuid REFERENCES jurisdictions(id),
  target_name text NOT NULL,
  target_code text,
  start_date date,
  end_date date,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED')),
  created_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);

CREATE TABLE IF NOT EXISTS campaign_geo_scope (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  geo_unit_id uuid NOT NULL REFERENCES geo_units(id),
  scope_role text NOT NULL DEFAULT 'WORKING_MANDAL' CHECK (scope_role IN ('WORKING_MANDAL')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, geo_unit_id)
);

CREATE TABLE IF NOT EXISTS campaign_mandal_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  mandal_geo_unit_id uuid NOT NULL REFERENCES geo_units(id),
  campaigner_user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'ASSIGNED' CHECK (status IN ('ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'REASSIGNED')),
  assigned_by_user_id uuid,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, mandal_geo_unit_id)
);

CREATE INDEX IF NOT EXISTS idx_campaigns_jurisdiction ON campaigns(jurisdiction_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status);
CREATE INDEX IF NOT EXISTS idx_campaign_geo_scope_geo ON campaign_geo_scope(geo_unit_id);
CREATE INDEX IF NOT EXISTS idx_campaign_assignments_campaigner ON campaign_mandal_assignments(campaigner_user_id);
CREATE INDEX IF NOT EXISTS idx_campaign_assignments_mandal ON campaign_mandal_assignments(mandal_geo_unit_id);

COMMIT;
