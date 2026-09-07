BEGIN;

-- Keeps campaign ownership explicit without duplicating the platform's
-- existing iteration records. The API adapter resolves iteration_id against
-- the canonical iterations endpoint/table used by the research workspace.
CREATE TABLE IF NOT EXISTS campaign_iteration_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  iteration_id uuid NOT NULL,
  created_by_user_id uuid NOT NULL REFERENCES users(id),
  status text NOT NULL DEFAULT 'PLANNED'
    CHECK (status IN ('PLANNED', 'ACTIVE', 'PAUSED', 'COMPLETED', 'LOCKED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, iteration_id)
);

CREATE INDEX IF NOT EXISTS idx_campaign_iteration_links_campaign
  ON campaign_iteration_links(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_iteration_links_iteration
  ON campaign_iteration_links(iteration_id);
CREATE INDEX IF NOT EXISTS idx_campaign_iteration_links_creator
  ON campaign_iteration_links(created_by_user_id);

COMMIT;
