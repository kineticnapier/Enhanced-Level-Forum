BEGIN;

-- ELF originally stored `song`, a separate `title`, and `creator`.  In actual
-- ADOFAI use the useful identity is the song plus artist and chart authorship.
-- Keep `title` for backwards compatibility with existing API/proposal data, but
-- new UI/API paths treat it as a legacy alias instead of asking staff to enter it.
ALTER TABLE levels
  ADD COLUMN IF NOT EXISTS artist text NULL,
  ADD COLUMN IF NOT EXISTS effecter text NULL;

UPDATE levels
SET artist = 'Unknown'
WHERE artist IS NULL OR btrim(artist) = '';

ALTER TABLE levels
  ALTER COLUMN artist SET NOT NULL;

-- Distribution/video links belong to a concrete chart version, just like its
-- checksum.  Different revisions may have different uploads and footage.
ALTER TABLE level_versions
  ADD COLUMN IF NOT EXISTS video_url text NULL;

COMMIT;
