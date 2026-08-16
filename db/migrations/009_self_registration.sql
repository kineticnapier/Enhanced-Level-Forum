BEGIN;

-- Public account creation is intentionally limited to VIEWER accounts.
-- Keep a small hashed audit/rate-limit ledger so anonymous sign-up cannot
-- create an unbounded number of accounts from one address in a short window.
CREATE TABLE IF NOT EXISTS auth_registration_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_hash char(64) NOT NULL,
  ip_hash char(64) NOT NULL,
  success boolean NOT NULL,
  attempted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS auth_registration_attempts_email_idx
  ON auth_registration_attempts(email_hash, attempted_at DESC);
CREATE INDEX IF NOT EXISTS auth_registration_attempts_ip_idx
  ON auth_registration_attempts(ip_hash, attempted_at DESC);
CREATE INDEX IF NOT EXISTS auth_registration_attempts_time_idx
  ON auth_registration_attempts(attempted_at);

COMMIT;
