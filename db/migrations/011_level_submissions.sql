BEGIN;

CREATE TABLE IF NOT EXISTS level_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submitted_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED','WITHDRAWN')),
  song text NOT NULL,
  artist text NOT NULL,
  creator text NOT NULL,
  effecter text NULL,
  version_label text NOT NULL,
  sha256 char(64) NULL,
  download_url text NULL,
  video_url text NULL,
  notes text NULL,
  review_note text NULL,
  reviewed_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at timestamptz NULL,
  created_level_id uuid NULL REFERENCES levels(id) ON DELETE SET NULL,
  created_level_version_id uuid NULL REFERENCES level_versions(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS level_submissions_status_created_idx
  ON level_submissions(status, created_at);
CREATE INDEX IF NOT EXISTS level_submissions_submitter_created_idx
  ON level_submissions(submitted_by, created_at DESC);
CREATE INDEX IF NOT EXISTS level_submissions_sha_idx
  ON level_submissions(lower(sha256)) WHERE sha256 IS NOT NULL;

COMMIT;
