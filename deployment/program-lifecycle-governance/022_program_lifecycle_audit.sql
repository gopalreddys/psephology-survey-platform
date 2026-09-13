ALTER TABLE operational_lifecycle_events
  DROP CONSTRAINT IF EXISTS operational_lifecycle_events_entity_type_check;

ALTER TABLE operational_lifecycle_events
  ADD CONSTRAINT operational_lifecycle_events_entity_type_check
  CHECK (
    entity_type IN (
      'CALL_EXECUTION', 'RUN', 'ITERATION', 'CAMPAIGN', 'PROGRAM'
    )
  );

INSERT INTO operational_lifecycle_events (
  entity_type, entity_id, next_status, trigger_source, details
)
SELECT
  'PROGRAM', program.id, COALESCE(program.status, 'DRAFT'), 'MIGRATION_SNAPSHOT',
  jsonb_build_object('baseline', true)
FROM survey_studies program
WHERE NOT EXISTS (
  SELECT 1
  FROM operational_lifecycle_events event
  WHERE event.entity_type = 'PROGRAM'
    AND event.entity_id = program.id
);
