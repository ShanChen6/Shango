CREATE TABLE driver_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES driver_profiles(user_id),
  kind text NOT NULL CHECK (kind IN ('identity_front','identity_back','driver_license','vehicle_registration')),
  storage_key uuid NOT NULL UNIQUE,
  content_type text NOT NULL CHECK (content_type='image/jpeg'),
  byte_size integer NOT NULL CHECK (byte_size > 0 AND byte_size <= 5242880),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz
);
CREATE UNIQUE INDEX driver_documents_current_kind_idx ON driver_documents(driver_id,kind) WHERE superseded_at IS NULL;
