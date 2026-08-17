BEGIN;

CREATE TABLE IF NOT EXISTS level_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  level_id uuid NOT NULL REFERENCES levels(id) ON DELETE CASCADE,
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'ORIGINAL' CHECK (kind IN ('ORIGINAL','NERFED','BUFFED','KEYLIMIT','NO_KEY_LIMIT','CUSTOM')),
  key_limit integer NULL CHECK (key_limit IS NULL OR key_limit >= 1),
  notes text NULL,
  is_primary boolean NOT NULL DEFAULT false,
  current_version_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS level_variants_name_idx
  ON level_variants(level_id, lower(name));
CREATE UNIQUE INDEX IF NOT EXISTS level_variants_primary_idx
  ON level_variants(level_id) WHERE is_primary;

ALTER TABLE level_versions
  ADD COLUMN IF NOT EXISTS variant_id uuid NULL;

-- Submission intake predates Variants. Preserve old pending rows as Original,
-- while allowing new submitters to specify the gameplay Variant explicitly.
ALTER TABLE level_submissions
  ADD COLUMN IF NOT EXISTS variant_name text NOT NULL DEFAULT 'Original',
  ADD COLUMN IF NOT EXISTS variant_kind text NOT NULL DEFAULT 'ORIGINAL',
  ADD COLUMN IF NOT EXISTS variant_key_limit integer NULL;

ALTER TABLE level_submissions
  DROP CONSTRAINT IF EXISTS level_submissions_variant_kind_check;
ALTER TABLE level_submissions
  ADD CONSTRAINT level_submissions_variant_kind_check
  CHECK (variant_kind IN ('ORIGINAL','NERFED','BUFFED','KEYLIMIT','NO_KEY_LIMIT','CUSTOM'));
ALTER TABLE level_submissions
  DROP CONSTRAINT IF EXISTS level_submissions_variant_key_limit_check;
ALTER TABLE level_submissions
  ADD CONSTRAINT level_submissions_variant_key_limit_check
  CHECK (variant_key_limit IS NULL OR variant_key_limit >= 1);

-- Every existing Level becomes one work page with one primary Original Variant.
-- Existing Versions keep their ids, ratings, votes, references and external links.
INSERT INTO level_variants(level_id,name,kind,is_primary,current_version_id)
SELECT l.id,'Original','ORIGINAL',true,l.current_version_id
FROM levels l
WHERE NOT EXISTS (SELECT 1 FROM level_variants v WHERE v.level_id=l.id);

UPDATE level_versions lv
SET variant_id=v.id
FROM level_variants v
WHERE v.level_id=lv.level_id AND v.is_primary AND lv.variant_id IS NULL;

ALTER TABLE level_versions
  ALTER COLUMN variant_id SET NOT NULL;

ALTER TABLE level_versions
  DROP CONSTRAINT IF EXISTS level_versions_variant_fk;
ALTER TABLE level_versions
  ADD CONSTRAINT level_versions_variant_fk
  FOREIGN KEY(variant_id) REFERENCES level_variants(id) ON DELETE CASCADE;

ALTER TABLE level_variants
  DROP CONSTRAINT IF EXISTS level_variants_current_version_fk;
ALTER TABLE level_variants
  ADD CONSTRAINT level_variants_current_version_fk
  FOREIGN KEY(current_version_id) REFERENCES level_versions(id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX IF NOT EXISTS level_versions_variant_created_idx
  ON level_versions(variant_id, created_at DESC);

-- Compatibility bridge: old code that inserts a Version with only level_id
-- transparently attaches it to the Level's primary Variant.
CREATE OR REPLACE FUNCTION elf_assign_primary_variant()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target_variant uuid;
  target_level uuid;
BEGIN
  IF NEW.variant_id IS NOT NULL THEN
    SELECT level_id INTO target_level FROM level_variants WHERE id=NEW.variant_id;
    IF target_level IS NULL OR target_level <> NEW.level_id THEN
      RAISE EXCEPTION 'level_version variant_id must belong to level_id';
    END IF;
    RETURN NEW;
  END IF;

  SELECT id INTO target_variant
  FROM level_variants
  WHERE level_id=NEW.level_id AND is_primary
  LIMIT 1;

  IF target_variant IS NULL THEN
    INSERT INTO level_variants(level_id,name,kind,is_primary)
    VALUES (NEW.level_id,'Original','ORIGINAL',true)
    RETURNING id INTO target_variant;
  END IF;

  NEW.variant_id := target_variant;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS level_versions_assign_primary_variant ON level_versions;
CREATE TRIGGER level_versions_assign_primary_variant
BEFORE INSERT OR UPDATE OF level_id,variant_id ON level_versions
FOR EACH ROW EXECUTE FUNCTION elf_assign_primary_variant();

CREATE OR REPLACE FUNCTION elf_set_variant_first_version()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE level_variants
  SET current_version_id=COALESCE(current_version_id, NEW.id), updated_at=now()
  WHERE id=NEW.variant_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS level_versions_set_variant_first_version ON level_versions;
CREATE TRIGGER level_versions_set_variant_first_version
AFTER INSERT ON level_versions
FOR EACH ROW EXECUTE FUNCTION elf_set_variant_first_version();

COMMIT;
