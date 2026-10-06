BEGIN;

CREATE TABLE IF NOT EXISTS analytics_geo_boundary_reference (
  id bigserial PRIMARY KEY,
  boundary_type text NOT NULL CHECK (
    boundary_type IN ('STATE', 'DISTRICT', 'ASSEMBLY_CONSTITUENCY', 'MANDAL')
  ),
  source_layer_id integer NOT NULL,
  source_object_id bigint NOT NULL,
  boundary_code text,
  boundary_name text NOT NULL,
  parent_district_name text,
  parent_division_name text,
  geometry jsonb NOT NULL,
  source_attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_name text NOT NULL,
  source_url text NOT NULL,
  source_spatial_reference text NOT NULL DEFAULT 'EPSG:4326',
  demo_scope text CHECK (demo_scope IN ('PRIMARY', 'CONTEXT')),
  verified_at timestamptz NOT NULL,
  is_active boolean NOT NULL DEFAULT TRUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (boundary_type, source_layer_id, source_object_id)
);

CREATE INDEX IF NOT EXISTS analytics_geo_boundary_type_active_idx
  ON analytics_geo_boundary_reference (boundary_type, is_active);

CREATE INDEX IF NOT EXISTS analytics_geo_boundary_demo_scope_idx
  ON analytics_geo_boundary_reference (demo_scope)
  WHERE demo_scope IS NOT NULL AND is_active = TRUE;

COMMENT ON TABLE analytics_geo_boundary_reference IS
  'Official Telangana administrative polygons synchronized from TGRAC for governed aggregate map presentation. Contains no voter or respondent location data.';

COMMENT ON COLUMN analytics_geo_boundary_reference.geometry IS
  'GeoJSON Polygon or MultiPolygon projected to EPSG:4326 by the authoritative ArcGIS service.';

COMMIT;
