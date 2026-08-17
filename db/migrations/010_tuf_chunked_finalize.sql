BEGIN;

ALTER TABLE tuf_crawl_state
  ADD COLUMN IF NOT EXISTS phase text NOT NULL DEFAULT 'CRAWL',
  ADD COLUMN IF NOT EXISTS finalize_offset integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS references_raw jsonb NULL,
  ADD COLUMN IF NOT EXISTS finalize_started_at timestamptz NULL;

ALTER TABLE tuf_crawl_state DROP CONSTRAINT IF EXISTS tuf_crawl_state_phase_check;
ALTER TABLE tuf_crawl_state ADD CONSTRAINT tuf_crawl_state_phase_check
  CHECK (phase IN ('CRAWL','FINALIZE_LEVELS','PUBLISH'));

ALTER TABLE tuf_crawl_state DROP CONSTRAINT IF EXISTS tuf_crawl_state_last_status_check;
ALTER TABLE tuf_crawl_state ADD CONSTRAINT tuf_crawl_state_last_status_check
  CHECK (last_status IS NULL OR last_status IN ('PROGRESS','FINALIZING','DEFERRED','RESET','BUSY','IMPORTED','FAILED'));

CREATE TABLE IF NOT EXISTS tuf_finalize_levels (
  crawl_id uuid NOT NULL,
  external_id text NOT NULL,
  linked_level_id uuid NULL REFERENCES levels(id) ON DELETE SET NULL,
  linked_level_version_id uuid NULL REFERENCES level_versions(id) ON DELETE SET NULL,
  sha256 char(64) NULL,
  song text NULL,
  title text NULL,
  creator text NULL,
  download_url text NULL,
  difficulty_label text NULL,
  family text NULL CHECK (family IS NULL OR family IN ('P','G','U')),
  tier integer NULL,
  raw_data jsonb NOT NULL,
  PRIMARY KEY(crawl_id, external_id)
);
CREATE INDEX IF NOT EXISTS tuf_finalize_levels_sha_idx ON tuf_finalize_levels(crawl_id, sha256);

CREATE TABLE IF NOT EXISTS tuf_finalize_issues (
  id bigserial PRIMARY KEY,
  crawl_id uuid NOT NULL,
  severity text NOT NULL CHECK (severity IN ('INFO','WARNING','ERROR')),
  kind text NOT NULL,
  external_id text NULL,
  linked_level_id uuid NULL REFERENCES levels(id) ON DELETE SET NULL,
  linked_level_version_id uuid NULL REFERENCES level_versions(id) ON DELETE SET NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS tuf_finalize_issues_crawl_idx ON tuf_finalize_issues(crawl_id);

COMMIT;
