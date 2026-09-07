BEGIN;

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS survey_stage text NOT NULL DEFAULT 'BASE';

ALTER TABLE campaigns
  DROP CONSTRAINT IF EXISTS campaigns_survey_stage_check;

ALTER TABLE campaigns
  ADD CONSTRAINT campaigns_survey_stage_check
  CHECK (survey_stage IN ('BASE', 'CAMPAIGN', 'TURNOUT'));

CREATE INDEX IF NOT EXISTS idx_campaigns_survey_stage ON campaigns(survey_stage);

COMMIT;
