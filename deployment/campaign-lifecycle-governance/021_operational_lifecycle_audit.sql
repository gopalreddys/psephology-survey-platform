CREATE TABLE IF NOT EXISTS operational_lifecycle_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL CHECK (
    entity_type IN ('CALL_EXECUTION', 'RUN', 'ITERATION', 'CAMPAIGN')
  ),
  entity_id uuid NOT NULL,
  parent_entity_id uuid,
  previous_status text,
  next_status text NOT NULL,
  trigger_source text NOT NULL,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS operational_lifecycle_events_entity_idx
  ON operational_lifecycle_events (entity_type, entity_id, created_at DESC);

CREATE INDEX IF NOT EXISTS operational_lifecycle_events_parent_idx
  ON operational_lifecycle_events (parent_entity_id, created_at DESC)
  WHERE parent_entity_id IS NOT NULL;

INSERT INTO operational_lifecycle_events (
  entity_type, entity_id, next_status, trigger_source, details
)
SELECT
  'CAMPAIGN', campaign.id, campaign.status, 'MIGRATION_SNAPSHOT',
  jsonb_build_object('baseline', true)
FROM campaigns campaign
WHERE NOT EXISTS (
  SELECT 1 FROM operational_lifecycle_events event
  WHERE event.entity_type = 'CAMPAIGN' AND event.entity_id = campaign.id
);

INSERT INTO operational_lifecycle_events (
  entity_type, entity_id, parent_entity_id, next_status, trigger_source, details
)
SELECT
  'ITERATION', link.iteration_id, link.campaign_id, link.status,
  'MIGRATION_SNAPSHOT', jsonb_build_object('baseline', true)
FROM campaign_iteration_links link
WHERE NOT EXISTS (
  SELECT 1 FROM operational_lifecycle_events event
  WHERE event.entity_type = 'ITERATION' AND event.entity_id = link.iteration_id
);

INSERT INTO operational_lifecycle_events (
  entity_type, entity_id, parent_entity_id, next_status, trigger_source, details
)
SELECT
  'RUN', run.id, link.campaign_id, run.status, 'MIGRATION_SNAPSHOT',
  jsonb_build_object(
    'baseline', true,
    'iterationId', run.iteration_id,
    'runNumber', run.run_number
  )
FROM campaign_runs run
LEFT JOIN campaign_iteration_links link ON link.iteration_id = run.iteration_id
WHERE NOT EXISTS (
  SELECT 1 FROM operational_lifecycle_events event
  WHERE event.entity_type = 'RUN' AND event.entity_id = run.id
);
