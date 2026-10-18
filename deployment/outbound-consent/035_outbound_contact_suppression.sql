BEGIN;

-- Only newly reserved standalone calls populate this snapshot. Do not invent
-- the originally dialed number for older requests from today's master record.
ALTER TABLE public.voter_demo_calls
  ADD COLUMN IF NOT EXISTS submitted_phone_snapshot text;
COMMENT ON COLUMN public.voter_demo_calls.submitted_phone_snapshot IS
  'Sensitive canonical dialed destination retained for opt-out enforcement; NULL for legacy requests without a retained original number.';

-- Deliberately additive: no historical callback, response, contact or voter
-- record is changed, and no undocumented voter_master status is introduced.
CREATE TABLE IF NOT EXISTS public.outbound_contact_suppressions_v1 (
  identifier_kind text NOT NULL CHECK (identifier_kind IN ('PHONE', 'VOTER')),
  identifier_hash text NOT NULL CHECK (identifier_hash ~ '^[0-9a-f]{64}$'),
  source text NOT NULL CHECK (length(source) BETWEEN 1 AND 80),
  source_attempt_id text CHECK (length(source_attempt_id) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (identifier_kind, identifier_hash)
);

COMMENT ON TABLE public.outbound_contact_suppressions_v1 IS
  'Sticky outbound opt-out identifiers. SHA-256 digests are sensitive pseudonymous identifiers, not anonymized data. No phone number is stored in this table. No automatic reactivation or retrospective backfill.';

CREATE OR REPLACE FUNCTION public.outbound_mobile_normalize_v1(phone text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog
AS $function$
  WITH compact AS (
    SELECT regexp_replace(btrim(phone), '[[:space:]().-]', '', 'g') AS value
  )
  SELECT CASE
    WHEN value ~ '^[+]91[6-9][0-9]{9}$' THEN value
    WHEN value ~ '^91[6-9][0-9]{9}$' THEN '+' || value
    WHEN value ~ '^0[6-9][0-9]{9}$' THEN '+91' || substring(value FROM 2)
    WHEN value ~ '^[6-9][0-9]{9}$' THEN '+91' || value
    ELSE NULL
  END
  FROM compact;
$function$;

CREATE OR REPLACE FUNCTION public.outbound_contact_is_suppressed_v1(voter_id uuid, phone text)
RETURNS boolean
LANGUAGE sql STABLE PARALLEL SAFE
SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
  WITH canonical AS (
    SELECT public.outbound_mobile_normalize_v1(phone) AS phone
  )
  SELECT voter_id IS NULL OR canonical.phone IS NULL OR EXISTS (
    SELECT 1
    FROM public.outbound_contact_suppressions_v1 suppression
    WHERE (suppression.identifier_kind = 'VOTER'
      AND suppression.identifier_hash = encode(sha256(convert_to(voter_id::text, 'UTF8')), 'hex'))
      OR (suppression.identifier_kind = 'PHONE'
      AND suppression.identifier_hash = encode(sha256(convert_to(canonical.phone, 'UTF8')), 'hex'))
  )
  FROM canonical;
$function$;

-- There is intentionally no active=false flag or automatic re-consent path.
-- Any future, explicitly authorized re-consent workflow needs a separate review.
CREATE OR REPLACE FUNCTION public.outbound_suppression_append_only_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $function$
BEGIN
  RAISE EXCEPTION 'Outbound contact suppressions are append-only; reviewed re-consent is required'
    USING ERRCODE = '55000';
END;
$function$;

DO $block$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger
    WHERE tgrelid = 'public.outbound_contact_suppressions_v1'::regclass
      AND tgname = 'outbound_suppression_append_only_v1'
      AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER outbound_suppression_append_only_v1
      BEFORE UPDATE OR DELETE ON public.outbound_contact_suppressions_v1
      FOR EACH ROW EXECUTE FUNCTION public.outbound_suppression_append_only_v1();
  END IF;
END;
$block$;

COMMIT;
