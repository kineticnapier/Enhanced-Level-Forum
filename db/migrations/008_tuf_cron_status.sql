BEGIN;

ALTER TABLE tuf_crawl_state
  ADD COLUMN IF NOT EXISTS last_run_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS last_status text NULL,
  ADD COLUMN IF NOT EXISTS last_reason text NULL,
  ADD COLUMN IF NOT EXISTS last_pages_fetched integer NULL CHECK (last_pages_fetched IS NULL OR last_pages_fetched >= 0),
  ADD COLUMN IF NOT EXISTS last_snapshot_id uuid NULL REFERENCES import_snapshots(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS consecutive_deferred integer NOT NULL DEFAULT 0 CHECK (consecutive_deferred >= 0);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tuf_crawl_state_last_status_check'
  ) THEN
    ALTER TABLE tuf_crawl_state
      ADD CONSTRAINT tuf_crawl_state_last_status_check
      CHECK (last_status IS NULL OR last_status IN ('PROGRESS','DEFERRED','RESET','BUSY','IMPORTED','FAILED'));
  END IF;
END $$;

COMMIT;
