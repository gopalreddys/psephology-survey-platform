BEGIN;

-- Every campaign is operated under an Admin-controlled research program.
-- NOT VALID keeps an existing installation upgradeable; it still enforces the
-- rule for every new or updated campaign row. Backfill legacy NULL rows before
-- validating this constraint in a later maintenance window.
ALTER TABLE campaigns
  DROP CONSTRAINT IF EXISTS campaigns_program_required;

ALTER TABLE campaigns
  ADD CONSTRAINT campaigns_program_required
  CHECK (program_id IS NOT NULL) NOT VALID;

CREATE INDEX IF NOT EXISTS idx_campaigns_program ON campaigns(program_id);

COMMIT;
