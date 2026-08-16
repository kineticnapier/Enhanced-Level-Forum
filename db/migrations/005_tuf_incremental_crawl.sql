BEGIN;

-- Scheduled TUF imports crawl the upstream API in small, persistent chunks.
-- These tables are staging only; they never represent canonical ELF data.
CREATE TABLE IF NOT EXISTS tuf_crawl_state (
  source text PRIMARY KEY,
  crawl_id uuid NOT NULL DEFAULT gen_random_uuid(),
  next_offset integer NOT NULL DEFAULT 0 CHECK (next_offset >= 0),
  observed_total integer NULL CHECK (observed_total IS NULL OR observed_total >= 0),
  started_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tuf_crawl_levels (
  crawl_id uuid NOT NULL,
  position integer NOT NULL CHECK (position >= 0),
  external_id text NULL,
  raw_data jsonb NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (crawl_id, position)
);

CREATE INDEX IF NOT EXISTS tuf_crawl_levels_external_idx
  ON tuf_crawl_levels(crawl_id, external_id);

COMMIT;
