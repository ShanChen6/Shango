-- WEB-003/ADR-002: additive web transport metadata. Rollback keeps these columns.
ALTER TABLE auth_sessions
  ADD COLUMN transport text NOT NULL DEFAULT 'legacy' CHECK (transport IN ('legacy','web')),
  ADD COLUMN app text CHECK (app IN ('customer','driver','admin'));
ALTER TABLE auth_sessions
  ADD CONSTRAINT auth_sessions_web_app_check CHECK ((transport = 'web') = (app IS NOT NULL));
