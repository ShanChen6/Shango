-- SG-015: service areas as PostGIS polygons. Quotes and orders require pickup and dropoff to be
-- covered by an active area. Geometry (planar lng/lat, SRID 4326) so edges match what is drawn on
-- the map; coordinates are always (longitude, latitude).
CREATE TABLE service_areas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (code ~ '^[a-z0-9-]{3,40}$'),
  name text NOT NULL CHECK (length(name) BETWEEN 2 AND 80),
  area geometry(MultiPolygon, 4326) NOT NULL CHECK (ST_IsValid(area)),
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX service_areas_area_gix ON service_areas USING gist(area);

-- Every saved revision, so an earlier shape can be inspected or restored.
CREATE TABLE service_area_versions (
  area_id uuid NOT NULL REFERENCES service_areas(id),
  version integer NOT NULL,
  name text NOT NULL,
  area geometry(MultiPolygon, 4326) NOT NULL,
  active boolean NOT NULL,
  changed_by uuid REFERENCES users(id),
  changed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (area_id, version)
);

-- Placeholder: the former Hanoi discovery rectangle, so behaviour is unchanged until the PO
-- approves a real delivery polygon and an admin saves it.
INSERT INTO service_areas (code, name, area)
VALUES ('hanoi-pilot', 'Hà Nội (khung tạm, chờ PO duyệt)',
        ST_Multi(ST_MakeEnvelope(105.3, 20.55, 106.05, 21.4, 4326)));
INSERT INTO service_area_versions (area_id, version, name, area, active)
SELECT id, version, name, area, active FROM service_areas;
