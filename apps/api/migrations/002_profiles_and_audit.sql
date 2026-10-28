ALTER TABLE users
  ADD COLUMN profile_version integer NOT NULL DEFAULT 0 CHECK (profile_version >= 0),
  ADD COLUMN profile_updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX audit_logs_actor_id_idx ON audit_logs(actor_id, id DESC);
CREATE INDEX audit_logs_action_id_idx ON audit_logs(action, id DESC);
CREATE INDEX audit_logs_entity_id_idx ON audit_logs(entity_id, id DESC);
