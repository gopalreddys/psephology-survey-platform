BEGIN;

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS target_domain text NOT NULL DEFAULT 'LEGISLATIVE',
  ADD COLUMN IF NOT EXISTS local_body_id uuid REFERENCES local_bodies(id),
  ADD COLUMN IF NOT EXISTS local_body_area_id uuid REFERENCES local_body_electoral_areas(id);

ALTER TABLE campaigns DROP CONSTRAINT IF EXISTS campaigns_target_type_check;
ALTER TABLE campaigns ADD CONSTRAINT campaigns_target_type_check
  CHECK (target_type IN ('MP', 'MLA', 'MLC', 'ZPTC', 'MPTC', 'GRAM_PANCHAYAT', 'MUNICIPAL_CORPORATION', 'MUNICIPALITY'));
ALTER TABLE campaigns DROP CONSTRAINT IF EXISTS campaigns_target_domain_check;
ALTER TABLE campaigns ADD CONSTRAINT campaigns_target_domain_check CHECK (target_domain IN ('LEGISLATIVE', 'LOCAL_BODY'));

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campaigns_created_by_user_fkey') THEN
    ALTER TABLE campaigns ADD CONSTRAINT campaigns_created_by_user_fkey
      FOREIGN KEY (created_by_user_id) REFERENCES users(id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS campaign_work_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  allocation_level text NOT NULL CHECK (allocation_level IN ('DISTRICT', 'MANDAL', 'VILLAGE', 'LOCAL_BODY_AREA')),
  geo_unit_id uuid REFERENCES geo_units(id),
  local_body_area_id uuid REFERENCES local_body_electoral_areas(id),
  campaigner_user_id uuid NOT NULL REFERENCES users(id),
  status text NOT NULL DEFAULT 'ASSIGNED' CHECK (status IN ('ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'REASSIGNED')),
  assigned_by_user_id uuid NOT NULL REFERENCES users(id),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((allocation_level = 'LOCAL_BODY_AREA' AND local_body_area_id IS NOT NULL AND geo_unit_id IS NULL)
    OR (allocation_level <> 'LOCAL_BODY_AREA' AND geo_unit_id IS NOT NULL AND local_body_area_id IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_campaign_work_geo_allocation
  ON campaign_work_allocations(campaign_id, allocation_level, geo_unit_id)
  WHERE geo_unit_id IS NOT NULL AND status <> 'REASSIGNED';
CREATE UNIQUE INDEX IF NOT EXISTS uq_campaign_work_local_area_allocation
  ON campaign_work_allocations(campaign_id, local_body_area_id)
  WHERE local_body_area_id IS NOT NULL AND status <> 'REASSIGNED';
CREATE INDEX IF NOT EXISTS idx_campaigns_created_by ON campaigns(created_by_user_id);
CREATE INDEX IF NOT EXISTS idx_campaign_work_campaigner ON campaign_work_allocations(campaigner_user_id);
CREATE INDEX IF NOT EXISTS idx_campaign_work_campaign ON campaign_work_allocations(campaign_id);

COMMIT;
