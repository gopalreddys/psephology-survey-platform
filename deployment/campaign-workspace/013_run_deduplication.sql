BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM campaign_runs
    GROUP BY iteration_id, run_number
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate run numbers exist within an iteration; resolve them before applying migration 013';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_campaign_runs_iteration_number
  ON campaign_runs(iteration_id, run_number);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM campaign_run_cycles
    GROUP BY run_id, cycle_number
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate cycle numbers exist within a Run; resolve them before applying migration 013';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_campaign_run_cycles_run_number
  ON campaign_run_cycles(run_id, cycle_number);

CREATE OR REPLACE FUNCTION prevent_active_voter_in_multiple_runs()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_iteration_id uuid;
BEGIN
  SELECT iteration_id INTO target_iteration_id
  FROM campaign_runs
  WHERE id = NEW.run_id;

  IF target_iteration_id IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(target_iteration_id::text, 0));

  IF EXISTS (
    SELECT 1
    FROM campaign_run_contacts existing_contact
    JOIN campaign_runs existing_run ON existing_run.id = existing_contact.run_id
    WHERE existing_contact.voter_id = NEW.voter_id
      AND existing_run.iteration_id = target_iteration_id
      AND existing_run.id <> NEW.run_id
      AND existing_run.status NOT IN ('COMPLETED', 'FAILED', 'CANCELLED', 'ARCHIVED')
      AND COALESCE(existing_contact.final_status, 'UNRESOLVED') NOT IN (
        'SUCCESS_PULSE', 'SUCCESS_COMPLETE', 'SUCCESS_SUBSTANTIAL',
        'REFUSED_TERMINAL', 'DO_NOT_CALL', 'INVALID_NUMBER'
      )
  ) THEN
    RAISE EXCEPTION 'Voter % is already active in another Run for this iteration', NEW.voter_id
      USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_active_voter_multiple_runs ON campaign_run_contacts;

CREATE TRIGGER trg_prevent_active_voter_multiple_runs
BEFORE INSERT ON campaign_run_contacts
FOR EACH ROW
EXECUTE FUNCTION prevent_active_voter_in_multiple_runs();

COMMIT;
