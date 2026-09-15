ALTER TABLE program_iterations
  ADD COLUMN IF NOT EXISTS questionnaire_snapshot jsonb;

COMMENT ON COLUMN program_iterations.questionnaire_snapshot IS
  'Questionnaire code, name, version and status frozen when the iteration was created; historical nulls are not inferred.';
