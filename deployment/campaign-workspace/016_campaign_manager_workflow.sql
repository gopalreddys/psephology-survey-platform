BEGIN;

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS campaign_manager_user_id uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS campaign_manager_assigned_by_user_id uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS campaign_manager_assigned_at timestamptz;

ALTER TABLE campaign_work_allocations
  ADD COLUMN IF NOT EXISTS iteration_id uuid REFERENCES program_iterations(id);

-- Preserve legacy campaigns that were created directly by a Campaign Manager.
UPDATE campaigns campaign
SET campaign_manager_user_id = campaign.created_by_user_id,
    campaign_manager_assigned_at = COALESCE(campaign_manager_assigned_at, campaign.created_at)
FROM users account
JOIN roles role ON role.id = account.role_id
WHERE campaign.campaign_manager_user_id IS NULL
  AND campaign.created_by_user_id = account.id
  AND role.code = 'CAMPAIGN_MANAGER';

DROP INDEX IF EXISTS uq_campaign_work_geo_allocation;
DROP INDEX IF EXISTS uq_campaign_work_local_area_allocation;

CREATE UNIQUE INDEX IF NOT EXISTS uq_campaign_work_geo_iteration_allocation
  ON campaign_work_allocations(
    campaign_id,
    COALESCE(iteration_id, '00000000-0000-0000-0000-000000000000'::uuid),
    allocation_level,
    geo_unit_id
  )
  WHERE geo_unit_id IS NOT NULL AND status <> 'REASSIGNED';

CREATE UNIQUE INDEX IF NOT EXISTS uq_campaign_work_area_iteration_allocation
  ON campaign_work_allocations(
    campaign_id,
    COALESCE(iteration_id, '00000000-0000-0000-0000-000000000000'::uuid),
    local_body_area_id
  )
  WHERE local_body_area_id IS NOT NULL AND status <> 'REASSIGNED';

CREATE INDEX IF NOT EXISTS idx_campaigns_campaign_manager
  ON campaigns(campaign_manager_user_id);

CREATE INDEX IF NOT EXISTS idx_campaign_work_iteration
  ON campaign_work_allocations(iteration_id, campaigner_user_id, status);

COMMIT;
