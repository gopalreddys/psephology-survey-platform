BEGIN;

-- voter_master is the canonical person/contact record. An EPIC is an
-- election-specific identifier, not the primary identity of every person.
ALTER TABLE voter_master
  ALTER COLUMN epic_number DROP NOT NULL;

CREATE TABLE IF NOT EXISTS voter_identifiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  voter_id uuid NOT NULL REFERENCES voter_master(id) ON DELETE CASCADE,
  identifier_type text NOT NULL CHECK (
    identifier_type IN (
      'EPIC', 'MLC_GRADUATE_ROLL', 'MLC_TEACHER_ROLL',
      'MLC_LOCAL_AUTHORITY_ROLL', 'LOCAL_BODY_ROLL',
      'INTERNAL_DEMO', 'OTHER'
    )
  ),
  identifier_value text NOT NULL,
  normalized_value text GENERATED ALWAYS AS (
    upper(regexp_replace(identifier_value, '[^A-Za-z0-9]', '', 'g'))
  ) STORED,
  issuing_authority text,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (
    status IN ('ACTIVE', 'SUPERSEDED', 'REVOKED', 'UNVERIFIED')
  ),
  is_primary boolean NOT NULL DEFAULT FALSE,
  valid_from date,
  valid_to date,
  source_name text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (length(trim(identifier_value)) > 0),
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_voter_identifier_value
  ON voter_identifiers(identifier_type, normalized_value)
  WHERE status IN ('ACTIVE', 'UNVERIFIED');
CREATE UNIQUE INDEX IF NOT EXISTS uq_voter_primary_identifier_type
  ON voter_identifiers(voter_id, identifier_type)
  WHERE is_primary = TRUE AND status IN ('ACTIVE', 'UNVERIFIED');
CREATE INDEX IF NOT EXISTS idx_voter_identifiers_voter
  ON voter_identifiers(voter_id, identifier_type);

CREATE TABLE IF NOT EXISTS voter_electorate_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  voter_id uuid NOT NULL REFERENCES voter_master(id) ON DELETE CASCADE,
  electorate_type text NOT NULL CHECK (
    electorate_type IN (
      'PARLIAMENTARY', 'ASSEMBLY', 'MLC_GRADUATES', 'MLC_TEACHERS',
      'MLC_LOCAL_AUTHORITIES', 'LOCAL_BODY', 'DEMO'
    )
  ),
  target_type text NOT NULL CHECK (
    target_type IN (
      'MP', 'MLA', 'MLC', 'ZPTC', 'MPTC', 'GRAM_PANCHAYAT',
      'MUNICIPAL_CORPORATION', 'MUNICIPALITY', 'DEMO'
    )
  ),
  jurisdiction_id uuid REFERENCES jurisdictions(id),
  local_body_id uuid REFERENCES local_bodies(id),
  local_body_area_id uuid REFERENCES local_body_electoral_areas(id),
  geo_unit_id uuid REFERENCES geo_units(id),
  target_code text,
  roll_identifier_id uuid REFERENCES voter_identifiers(id),
  eligibility_basis text NOT NULL CHECK (
    eligibility_basis IN (
      'EPIC', 'GRADUATE_ROLL', 'TEACHER_ROLL',
      'LOCAL_AUTHORITY_ROLL', 'LOCAL_BODY_ROLL',
      'CONSENTED_DEMO', 'OTHER'
    )
  ),
  eligibility_status text NOT NULL DEFAULT 'UNVERIFIED' CHECK (
    eligibility_status IN ('ELIGIBLE', 'VERIFIED', 'UNVERIFIED', 'INACTIVE', 'REJECTED')
  ),
  source_name text,
  verified_at timestamptz,
  valid_from date,
  valid_to date,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from),
  CHECK (
    electorate_type = 'DEMO'
    OR jurisdiction_id IS NOT NULL
    OR local_body_id IS NOT NULL
    OR local_body_area_id IS NOT NULL
    OR geo_unit_id IS NOT NULL
    OR target_code IS NOT NULL
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_voter_electorate_registration
  ON voter_electorate_registrations (
    voter_id, electorate_type, target_type,
    COALESCE(jurisdiction_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(local_body_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(local_body_area_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(geo_unit_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(target_code, '')
  )
  WHERE eligibility_status IN ('ELIGIBLE', 'VERIFIED', 'UNVERIFIED');
CREATE INDEX IF NOT EXISTS idx_voter_electorate_lookup
  ON voter_electorate_registrations (
    electorate_type, target_type, jurisdiction_id, local_body_id,
    local_body_area_id, geo_unit_id, eligibility_status
  );

-- Preserve old EPIC values as identifiers without inventing MLC/local eligibility.
INSERT INTO voter_identifiers (
  voter_id, identifier_type, identifier_value, issuing_authority,
  status, is_primary, source_name, metadata
)
SELECT
  voter.id, 'EPIC', voter.epic_number, 'Election Commission electoral roll',
  'UNVERIFIED', TRUE, COALESCE(voter.source_name, 'LEGACY_VOTER_MASTER'),
  jsonb_build_object('backfilledFrom', 'voter_master.epic_number')
FROM voter_master voter
WHERE length(trim(COALESCE(voter.epic_number, ''))) > 0
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION voter_is_eligible_for_campaign(
  requested_voter_id uuid,
  requested_campaign_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM voter_master voter
    JOIN campaigns campaign ON campaign.id = requested_campaign_id
    WHERE voter.id = requested_voter_id
      AND (
        voter.is_demo_contact = TRUE
        OR EXISTS (
          SELECT 1
          FROM voter_electorate_registrations registration
          WHERE registration.voter_id = voter.id
            AND registration.eligibility_status IN ('ELIGIBLE', 'VERIFIED')
            AND (
              (campaign.target_type = 'MP'
                AND registration.electorate_type = 'PARLIAMENTARY'
                AND registration.target_type = 'MP')
              OR (campaign.target_type = 'MLA'
                AND registration.electorate_type = 'ASSEMBLY'
                AND registration.target_type = 'MLA')
              OR (campaign.target_type = 'MLC'
                AND registration.electorate_type IN (
                  'MLC_GRADUATES', 'MLC_TEACHERS', 'MLC_LOCAL_AUTHORITIES'
                )
                AND registration.target_type = 'MLC')
              OR (campaign.target_domain = 'LOCAL_BODY'
                AND registration.electorate_type = 'LOCAL_BODY'
                AND registration.target_type = campaign.target_type)
            )
            AND (registration.jurisdiction_id IS NULL
              OR registration.jurisdiction_id = campaign.jurisdiction_id)
            AND (registration.local_body_id IS NULL
              OR registration.local_body_id = campaign.local_body_id)
            AND (registration.local_body_area_id IS NULL
              OR registration.local_body_area_id = campaign.local_body_area_id)
            AND (registration.target_code IS NULL
              OR registration.target_code = campaign.target_code)
            AND (registration.valid_from IS NULL OR registration.valid_from <= CURRENT_DATE)
            AND (registration.valid_to IS NULL OR registration.valid_to >= CURRENT_DATE)
        )
      )
  );
$$;

COMMENT ON TABLE voter_identifiers IS
  'Typed electoral and internal identifiers. EPIC is optional and is not the voter_master primary key.';
COMMENT ON TABLE voter_electorate_registrations IS
  'Election-specific roll membership. A person may have multiple registrations without duplicate voter_master rows.';

COMMIT;
