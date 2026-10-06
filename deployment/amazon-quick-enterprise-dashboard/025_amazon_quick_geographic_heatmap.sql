BEGIN;

CREATE TABLE IF NOT EXISTS analytics_geo_reference (
  id bigserial PRIMARY KEY,
  geography_type text NOT NULL
    CHECK (geography_type IN ('MANDAL', 'CONSTITUENCY')),
  geography_name text NOT NULL,
  normalized_name text GENERATED ALWAYS AS (
    lower(regexp_replace(trim(geography_name), '\s+', ' ', 'g'))
  ) STORED,
  state_name text NOT NULL DEFAULT 'Telangana',
  country_name text NOT NULL DEFAULT 'India',
  latitude numeric(9, 6) NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude numeric(9, 6) NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  source_url text,
  source_note text,
  verified_at timestamptz,
  is_active boolean NOT NULL DEFAULT TRUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (geography_type, normalized_name, state_name, country_name)
);

COMMENT ON TABLE analytics_geo_reference IS
  'Governed non-PII map centroids used by aggregate research dashboards. Production deployments should replace demo centroids with verified administrative boundaries.';

INSERT INTO analytics_geo_reference (
  geography_type,
  geography_name,
  state_name,
  country_name,
  latitude,
  longitude,
  source_url,
  source_note,
  verified_at
)
VALUES (
  'MANDAL',
  'Serilingampally',
  'Telangana',
  'India',
  17.461600,
  78.347100,
  'https://www.openstreetmap.org/search?query=Serilingampally%2C%20Telangana%2C%20India',
  'Demo centroid only. Replace with a verified Mandal polygon before production-scale geographic reporting.',
  now()
)
ON CONFLICT (geography_type, normalized_name, state_name, country_name)
DO UPDATE SET
  latitude = EXCLUDED.latitude,
  longitude = EXCLUDED.longitude,
  source_url = EXCLUDED.source_url,
  source_note = EXCLUDED.source_note,
  verified_at = EXCLUDED.verified_at,
  is_active = TRUE,
  updated_at = now();

CREATE OR REPLACE VIEW analytics_research_geographic_v1 AS
WITH normalized_research AS (
  SELECT
    research.*,
    CASE
      WHEN lower(COALESCE(research.party_salience, '')) ~
        '(^|[^a-z])(brs|trs|bharat rashtra samithi|telangana rashtra samithi)([^a-z]|$)'
        THEN 'BRS'
      WHEN lower(COALESCE(research.party_salience, '')) ~
        '(^|[^a-z])(bjp|bharatiya janata party)([^a-z]|$)'
        THEN 'BJP'
      WHEN lower(COALESCE(research.party_salience, '')) ~
        '(^|[^a-z])(congress|inc|indian national congress)([^a-z]|$)'
        THEN 'Congress'
      WHEN lower(COALESCE(research.party_salience, '')) ~
        '(^|[^a-z])(cpi|cpm|communist|left)([^a-z]|$)'
        THEN 'Left parties'
      WHEN NULLIF(trim(COALESCE(research.party_salience, '')), '') IS NULL
        THEN 'Not stated'
      ELSE 'Other / unclassified'
    END AS party_name
  FROM analytics_research_enterprise_v1 research
), geographic_rollup AS (
  SELECT
    research.program_id,
    research.program_code,
    research.program_name,
    research.campaign_id,
    research.campaign_code,
    research.campaign_name,
    research.constituency_code,
    research.constituency_name,
    research.iteration_id,
    research.iteration_number,
    research.iteration_name,
    research.mandal_name,
    reference.state_name,
    reference.country_name,
    reference.latitude::double precision AS latitude,
    reference.longitude::double precision AS longitude,
    research.party_name,
    COUNT(DISTINCT research.respondent_key)::integer AS respondent_count,
    ROUND(AVG(research.direct_party_strength), 2) AS average_party_strength,
    COUNT(DISTINCT research.respondent_key)
      FILTER (WHERE research.respondent_sentiment = 'Positive')::integer
      AS positive_respondents,
    COUNT(DISTINCT research.respondent_key)
      FILTER (WHERE research.respondent_sentiment = 'Negative')::integer
      AS negative_respondents,
    COUNT(DISTINCT research.respondent_key)
      FILTER (WHERE research.respondent_sentiment = 'Uncertain')::integer
      AS uncertain_respondents
  FROM normalized_research research
  JOIN analytics_geo_reference reference
    ON reference.geography_type = 'MANDAL'
   AND reference.is_active = TRUE
   AND reference.normalized_name =
     lower(regexp_replace(trim(research.mandal_name), '\s+', ' ', 'g'))
  GROUP BY
    research.program_id,
    research.program_code,
    research.program_name,
    research.campaign_id,
    research.campaign_code,
    research.campaign_name,
    research.constituency_code,
    research.constituency_name,
    research.iteration_id,
    research.iteration_number,
    research.iteration_name,
    research.mandal_name,
    reference.state_name,
    reference.country_name,
    reference.latitude,
    reference.longitude,
    research.party_name
)
SELECT
  geographic_rollup.*,
  respondent_count::numeric AS heat_weight,
  average_party_strength AS party_pulse_score,
  'Directional research evidence; not an election forecast'::text
    AS interpretation_label
FROM geographic_rollup
WHERE respondent_count >= 5;

COMMENT ON VIEW analytics_research_geographic_v1 IS
  'Minimum-cell-suppressed, non-PII Mandal party-pulse facts for Amazon Quick geospatial maps. Each published cell contains at least five distinct respondents.';

COMMIT;
