BEGIN;

CREATE TABLE IF NOT EXISTS sarvam_voice_agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_deployment_id text NOT NULL UNIQUE,
  app_id text NOT NULL,
  app_version integer NOT NULL CHECK (app_version > 0),
  provider_name text,
  description text,
  channel_direction text NOT NULL,
  provider_status text NOT NULL,
  connection_id text,
  outbound_phone_number text,
  catalog_source text NOT NULL DEFAULT 'SARVAM_DEPLOYMENT_API',
  usage_category text CHECK (usage_category IN (
    'URBAN_MALE',
    'URBAN_FEMALE',
    'RURAL_MALE',
    'RURAL_FEMALE'
  )),
  is_enabled boolean NOT NULL DEFAULT TRUE,
  provider_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  categorized_by_user_id uuid REFERENCES users(id),
  categorized_at timestamptz,
  last_synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE sarvam_voice_agents
  ADD COLUMN IF NOT EXISTS catalog_source text NOT NULL DEFAULT 'SARVAM_DEPLOYMENT_API';

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS voice_agent_id uuid REFERENCES sarvam_voice_agents(id),
  ADD COLUMN IF NOT EXISTS voice_agent_snapshot jsonb;

ALTER TABLE program_iterations
  ADD COLUMN IF NOT EXISTS voice_agent_id uuid REFERENCES sarvam_voice_agents(id),
  ADD COLUMN IF NOT EXISTS voice_agent_snapshot jsonb;

-- Preserve callable legacy iterations created while the agent snapshot lived on campaigns.
UPDATE program_iterations iteration
SET (voice_agent_id, voice_agent_snapshot) = (
  SELECT campaign.voice_agent_id, campaign.voice_agent_snapshot
  FROM campaign_iteration_links link
  JOIN campaigns campaign ON campaign.id = link.campaign_id
  WHERE link.iteration_id = iteration.id
    AND campaign.voice_agent_snapshot IS NOT NULL
  ORDER BY link.created_at DESC
  LIMIT 1
)
WHERE iteration.voice_agent_snapshot IS NULL
  AND EXISTS (
    SELECT 1
    FROM campaign_iteration_links link
    JOIN campaigns campaign ON campaign.id = link.campaign_id
    WHERE link.iteration_id = iteration.id
      AND campaign.voice_agent_snapshot IS NOT NULL
  );

CREATE INDEX IF NOT EXISTS idx_sarvam_voice_agents_selectable
  ON sarvam_voice_agents(provider_status, channel_direction, usage_category)
  WHERE is_enabled = TRUE;

CREATE INDEX IF NOT EXISTS idx_campaigns_voice_agent
  ON campaigns(voice_agent_id);

CREATE INDEX IF NOT EXISTS idx_program_iterations_voice_agent
  ON program_iterations(voice_agent_id);

COMMIT;
