BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  display_name text NOT NULL,
  role text NOT NULL CHECK (role IN ('VIEWER','RATER','REFERENCE_MANAGER','MODERATOR','ADMIN')),
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash char(64) NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS levels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  song text NOT NULL,
  title text NOT NULL,
  creator text NOT NULL,
  status text NOT NULL DEFAULT 'LISTED' CHECK (status IN ('LISTED','UNLISTED','ARCHIVED')),
  current_version_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS level_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  level_id uuid NOT NULL REFERENCES levels(id) ON DELETE CASCADE,
  label text NOT NULL,
  sha256 char(64) NULL,
  download_url text NULL,
  notes text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(level_id, sha256)
);
CREATE UNIQUE INDEX IF NOT EXISTS level_versions_global_sha_idx
  ON level_versions(lower(sha256)) WHERE sha256 IS NOT NULL;

ALTER TABLE levels DROP CONSTRAINT IF EXISTS levels_current_version_fk;
ALTER TABLE levels ADD CONSTRAINT levels_current_version_fk
  FOREIGN KEY(current_version_id) REFERENCES level_versions(id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE IF NOT EXISTS external_level_ids (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  level_id uuid NOT NULL REFERENCES levels(id) ON DELETE CASCADE,
  source text NOT NULL,
  external_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(source, external_id)
);

-- Canonical difficulty remains an integer P/G/U tier. We explicitly do not
-- create a 100-step public scale. Confidence is metadata, not extra difficulty.
CREATE TABLE IF NOT EXISTS canonical_ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  level_version_id uuid NOT NULL REFERENCES level_versions(id) ON DELETE CASCADE,
  family text NOT NULL CHECK (family IN ('P','G','U')),
  tier integer NOT NULL CHECK (tier BETWEEN 1 AND 30),
  confidence numeric(5,4) NULL CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  reason text NULL,
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz NULL,
  decided_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE UNIQUE INDEX IF NOT EXISTS canonical_rating_current_idx
  ON canonical_ratings(level_version_id) WHERE effective_to IS NULL;
CREATE INDEX IF NOT EXISTS canonical_rating_family_tier_idx ON canonical_ratings(family, tier);

-- A rater does not pretend to know G9.63. They choose an integer anchor tier
-- and a coarse five-step lean. lean is evidence only; canonical output stays integer.
CREATE TABLE IF NOT EXISTS rating_votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  level_version_id uuid NOT NULL REFERENCES level_versions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family text NOT NULL CHECK (family IN ('P','G','U')),
  anchor_tier integer NOT NULL CHECK (anchor_tier BETWEEN 1 AND 30),
  lean smallint NOT NULL CHECK (lean BETWEEN -2 AND 2),
  confidence smallint NOT NULL DEFAULT 3 CHECK (confidence BETWEEN 1 AND 5),
  comment text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(level_version_id, user_id, family)
);
CREATE INDEX IF NOT EXISTS rating_votes_version_idx ON rating_votes(level_version_id);

CREATE TABLE IF NOT EXISTS difficulty_references (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  level_version_id uuid NOT NULL REFERENCES level_versions(id) ON DELETE CASCADE,
  family text NOT NULL CHECK (family IN ('P','G','U')),
  tier integer NOT NULL CHECK (tier BETWEEN 1 AND 30),
  technique text NOT NULL,
  -- Optional coarse descriptive hint inside a tier; never part of canonical difficulty.
  position_hint smallint NULL CHECK (position_hint IS NULL OR position_hint BETWEEN -2 AND 2),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','NEEDS_REVIEW','RETIRED')),
  confidence numeric(5,4) NULL CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  notes text NULL,
  created_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS difficulty_references_slot_idx ON difficulty_references(family, tier, technique, status);
CREATE UNIQUE INDEX IF NOT EXISTS difficulty_references_nonretired_identity_idx
  ON difficulty_references(level_version_id, family, tier, technique) WHERE status <> 'RETIRED';

CREATE TABLE IF NOT EXISTS reference_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_id uuid NOT NULL REFERENCES difficulty_references(id) ON DELETE CASCADE,
  action text NOT NULL,
  old_data jsonb NULL,
  new_data jsonb NULL,
  actor_id uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL CHECK (type IN ('RERATE','REFERENCE_ADD','REFERENCE_MOVE','REFERENCE_REMOVE','METADATA','OTHER')),
  level_id uuid NOT NULL REFERENCES levels(id) ON DELETE CASCADE,
  title text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','APPROVED','REJECTED','WITHDRAWN')),
  proposer_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  decision_reason text NULL,
  decided_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  decided_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS proposals_status_idx ON proposals(status, created_at DESC);

CREATE TABLE IF NOT EXISTS proposal_votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id uuid NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vote text NOT NULL CHECK (vote IN ('AGREE','DISAGREE','ABSTAIN')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(proposal_id, user_id)
);

CREATE TABLE IF NOT EXISTS proposal_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id uuid NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  category text NOT NULL
);

CREATE TABLE IF NOT EXISTS level_tags (
  level_id uuid NOT NULL REFERENCES levels(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY(level_id, tag_id)
);

CREATE TABLE IF NOT EXISTS import_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  source_version text NULL,
  raw_data jsonb NOT NULL,
  imported_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  imported_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS import_snapshots_source_idx ON import_snapshots(source, imported_at DESC);

CREATE TABLE IF NOT EXISTS external_rating_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  level_id uuid NOT NULL REFERENCES levels(id) ON DELETE CASCADE,
  level_version_id uuid NULL REFERENCES level_versions(id) ON DELETE SET NULL,
  snapshot_id uuid NOT NULL REFERENCES import_snapshots(id) ON DELETE CASCADE,
  source text NOT NULL,
  family text NULL CHECK (family IS NULL OR family IN ('P','G','U')),
  tier integer NULL,
  label text NULL,
  confidence numeric(5,4) NULL,
  observed_at timestamptz NOT NULL DEFAULT now(),
  raw_data jsonb NULL
);

CREATE TABLE IF NOT EXISTS analyzer_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_version text NOT NULL,
  config jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS analyzer_predictions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES analyzer_runs(id) ON DELETE CASCADE,
  level_version_id uuid NOT NULL REFERENCES level_versions(id) ON DELETE CASCADE,
  family text NULL CHECK (family IS NULL OR family IN ('P','G','U')),
  predicted_tier numeric(8,3) NULL,
  confidence numeric(5,4) NULL,
  details jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(run_id, level_version_id)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NULL,
  details jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_log_created_idx ON audit_log(created_at DESC);

CREATE TABLE IF NOT EXISTS schema_migrations (
  filename text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

COMMIT;
