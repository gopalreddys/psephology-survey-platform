-- Campaign Iterations are numbered 1–3 within their Campaign, not across a Program.
-- Run with the API stopped so no iteration can be inserted during the migration.

BEGIN;

ALTER TABLE program_iterations
  ADD COLUMN IF NOT EXISTS campaign_id uuid;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM campaign_iteration_links
    GROUP BY iteration_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'An Iteration belongs to multiple Campaigns; resolve links before migrating';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM campaign_iteration_links
    GROUP BY campaign_id
    HAVING COUNT(*) > 3
  ) THEN
    RAISE EXCEPTION 'A Campaign has more than three Iterations; review before migrating';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM campaign_iteration_links link
    JOIN program_iterations iteration ON iteration.id = link.iteration_id
    WHERE iteration.campaign_id IS NOT NULL
      AND iteration.campaign_id <> link.campaign_id
  ) THEN
    RAISE EXCEPTION 'Iteration Campaign ownership conflicts with its Campaign link';
  END IF;
END $$;

UPDATE program_iterations iteration
SET campaign_id = link.campaign_id
FROM campaign_iteration_links link
WHERE iteration.id = link.iteration_id
  AND iteration.campaign_id IS NULL;

-- The old Program-wide uniqueness prevents a second Campaign from starting at 1.
ALTER TABLE program_iterations
  DROP CONSTRAINT IF EXISTS program_iterations_study_id_iteration_number_key;

WITH numbered AS (
  SELECT iteration.id,
    ROW_NUMBER() OVER (
      PARTITION BY link.campaign_id
      ORDER BY iteration.iteration_number, iteration.created_at, iteration.id
    )::integer AS local_number
  FROM campaign_iteration_links link
  JOIN program_iterations iteration ON iteration.id = link.iteration_id
)
UPDATE program_iterations iteration
SET iteration_number = numbered.local_number
FROM numbered
WHERE iteration.id = numbered.id
  AND iteration.iteration_number <> numbered.local_number;

CREATE UNIQUE INDEX IF NOT EXISTS uq_campaign_iteration_number
  ON program_iterations (campaign_id, iteration_number)
  WHERE campaign_id IS NOT NULL;

-- Legacy Program Iterations that are not linked to a Campaign retain their rule.
CREATE UNIQUE INDEX IF NOT EXISTS uq_unlinked_program_iteration_number
  ON program_iterations (study_id, iteration_number)
  WHERE campaign_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_campaign_iteration_single_owner
  ON campaign_iteration_links (iteration_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'program_iterations_campaign_id_fkey'
      AND conrelid = 'program_iterations'::regclass
  ) THEN
    ALTER TABLE program_iterations
      ADD CONSTRAINT program_iterations_campaign_id_fkey
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'program_iterations_campaign_number_range'
      AND conrelid = 'program_iterations'::regclass
  ) THEN
    ALTER TABLE program_iterations
      ADD CONSTRAINT program_iterations_campaign_number_range
      CHECK (campaign_id IS NULL OR iteration_number BETWEEN 1 AND 3);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'program_iterations_id_campaign_key'
      AND conrelid = 'program_iterations'::regclass
  ) THEN
    ALTER TABLE program_iterations
      ADD CONSTRAINT program_iterations_id_campaign_key UNIQUE (id, campaign_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'campaign_iteration_links_owner_fkey'
      AND conrelid = 'campaign_iteration_links'::regclass
  ) THEN
    ALTER TABLE campaign_iteration_links
      ADD CONSTRAINT campaign_iteration_links_owner_fkey
      FOREIGN KEY (iteration_id, campaign_id)
      REFERENCES program_iterations (id, campaign_id);
  END IF;
END $$;

COMMIT;
