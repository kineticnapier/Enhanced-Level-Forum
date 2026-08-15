BEGIN;

-- External source observations are allowed to exist before they are linked to an
-- ELF Level. A source import must never need to create or rerate a canonical
-- Level merely to preserve what the external source currently says.
ALTER TABLE external_rating_observations
  ALTER COLUMN level_id DROP NOT NULL;

ALTER TABLE external_rating_observations
  ADD COLUMN IF NOT EXISTS external_id text NULL;

CREATE INDEX IF NOT EXISTS external_rating_observations_external_idx
  ON external_rating_observations(source, external_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS external_level_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id uuid NOT NULL REFERENCES import_snapshots(id) ON DELETE CASCADE,
  source text NOT NULL,
  external_id text NOT NULL,
  linked_level_id uuid NULL REFERENCES levels(id) ON DELETE SET NULL,
  linked_level_version_id uuid NULL REFERENCES level_versions(id) ON DELETE SET NULL,
  sha256 char(64) NULL,
  song text NULL,
  title text NULL,
  creator text NULL,
  download_url text NULL,
  difficulty_label text NULL,
  raw_data jsonb NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(snapshot_id, source, external_id)
);
CREATE INDEX IF NOT EXISTS external_level_observations_external_idx
  ON external_level_observations(source, external_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS external_level_observations_sha_idx
  ON external_level_observations(lower(sha256)) WHERE sha256 IS NOT NULL;

CREATE TABLE IF NOT EXISTS external_reference_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id uuid NOT NULL REFERENCES import_snapshots(id) ON DELETE CASCADE,
  source text NOT NULL,
  external_id text NOT NULL,
  linked_level_id uuid NULL REFERENCES levels(id) ON DELETE SET NULL,
  linked_level_version_id uuid NULL REFERENCES level_versions(id) ON DELETE SET NULL,
  family text NULL CHECK (family IS NULL OR family IN ('P','G','U')),
  tier integer NULL,
  difficulty_label text NULL,
  reference_type text NOT NULL,
  raw_data jsonb NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS external_reference_observations_slot_idx
  ON external_reference_observations(source, family, tier, reference_type);
CREATE INDEX IF NOT EXISTS external_reference_observations_external_idx
  ON external_reference_observations(source, external_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS import_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id uuid NOT NULL REFERENCES import_snapshots(id) ON DELETE CASCADE,
  source text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('INFO','WARNING','ERROR')),
  kind text NOT NULL,
  external_id text NULL,
  linked_level_id uuid NULL REFERENCES levels(id) ON DELETE SET NULL,
  linked_level_version_id uuid NULL REFERENCES level_versions(id) ON DELETE SET NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS import_issues_snapshot_idx
  ON import_issues(snapshot_id, severity, kind);

COMMIT;
