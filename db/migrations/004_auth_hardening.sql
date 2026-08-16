BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS password_changed_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS last_login_at timestamptz NULL;

CREATE INDEX IF NOT EXISTS users_active_role_idx ON users(is_active, role);

CREATE TABLE IF NOT EXISTS auth_login_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_hash char(64) NOT NULL,
  ip_hash char(64) NOT NULL,
  success boolean NOT NULL,
  attempted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS auth_login_attempts_email_idx
  ON auth_login_attempts(email_hash, attempted_at DESC);
CREATE INDEX IF NOT EXISTS auth_login_attempts_ip_idx
  ON auth_login_attempts(ip_hash, attempted_at DESC);
CREATE INDEX IF NOT EXISTS auth_login_attempts_time_idx
  ON auth_login_attempts(attempted_at);

COMMIT;
