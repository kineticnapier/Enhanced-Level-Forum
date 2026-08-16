BEGIN;

-- A rater should have one current opinion per Version. Older code allowed one
-- row per family, which could accidentally count the same person more than
-- once after changing P/G/U. Keep the newest vote and tighten the identity.
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY level_version_id,user_id
           ORDER BY updated_at DESC,created_at DESC,id DESC
         ) AS rn
  FROM rating_votes
)
DELETE FROM rating_votes
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

ALTER TABLE rating_votes
  DROP CONSTRAINT IF EXISTS rating_votes_level_version_id_user_id_family_key;
CREATE UNIQUE INDEX IF NOT EXISTS rating_votes_one_per_user_version_idx
  ON rating_votes(level_version_id,user_id);

-- Only explicitly opened Versions enter the queue. Unrated does not imply
-- "waiting for rating", so importing thousands of Levels cannot create an
-- unbounded backlog by itself.
CREATE TABLE IF NOT EXISTS rating_queue_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  level_version_id uuid NOT NULL UNIQUE REFERENCES level_versions(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','REVIEW_READY','CLOSED')),
  min_votes smallint NOT NULL DEFAULT 2 CHECK (min_votes BETWEEN 2 AND 5),
  max_votes smallint NOT NULL DEFAULT 3 CHECK (max_votes BETWEEN 3 AND 7 AND max_votes >= min_votes),
  priority integer NOT NULL DEFAULT 0,
  opened_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  opened_at timestamptz NOT NULL DEFAULT now(),
  review_ready_at timestamptz NULL,
  closed_at timestamptz NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rating_queue_status_priority_idx
  ON rating_queue_items(status,priority DESC,opened_at);

CREATE TABLE IF NOT EXISTS rating_queue_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_item_id uuid NOT NULL REFERENCES rating_queue_items(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUBMITTED','RELEASED')),
  claimed_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(queue_item_id,user_id)
);
CREATE INDEX IF NOT EXISTS rating_queue_claims_user_status_idx
  ON rating_queue_claims(user_id,status,claimed_at);

COMMIT;
