CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text NOT NULL UNIQUE CHECK (phone ~ '^\+[1-9][0-9]{7,14}$'),
  role text NOT NULL CHECK (role IN ('customer','driver','admin','dispatcher','accountant')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','blocked')),
  display_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE auth_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  refresh_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_sessions_user_idx ON auth_sessions(user_id);

CREATE TABLE driver_profiles (
  user_id uuid PRIMARY KEY REFERENCES users(id),
  vehicle_plate text NOT NULL,
  vehicle_type text NOT NULL CHECK (vehicle_type IN ('motorcycle','car')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  rejection_reason text,
  reviewed_by uuid REFERENCES users(id), reviewed_at timestamptz,
  updated_at timestamptz(3) NOT NULL DEFAULT date_trunc('milliseconds', clock_timestamp())
);
CREATE INDEX driver_profiles_status_idx ON driver_profiles(status, updated_at DESC);
CREATE TABLE driver_locations (
  driver_id uuid PRIMARY KEY REFERENCES driver_profiles(user_id),
  position geography(Point,4326) NOT NULL,
  is_available boolean NOT NULL DEFAULT false,
  last_seen_at timestamptz NOT NULL,
  sequence bigint NOT NULL DEFAULT 0 CHECK (sequence >= 0)
);
CREATE INDEX driver_locations_available_gix ON driver_locations USING gist(position) WHERE is_available=true;
CREATE TABLE audit_logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id uuid NOT NULL REFERENCES users(id),
  action text NOT NULL, entity_type text NOT NULL, entity_id uuid NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_entity_idx ON audit_logs(entity_type, entity_id, created_at DESC);
CREATE TABLE outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL, aggregate_id uuid NOT NULL, payload jsonb NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX outbox_pending_idx ON outbox_events(available_at) WHERE published_at IS NULL;
