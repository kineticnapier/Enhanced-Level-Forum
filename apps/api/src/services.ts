import type { Family, RatingLean, ReferenceStatus } from '@elf/shared'
import type { DbClient } from './db'
import { inTransaction } from './db'

export function normalizeFamily(value: unknown): Family | null {
  return value === 'P' || value === 'G' || value === 'U' ? value : null
}

export function normalizeTier(value: unknown): number | null {
  const tier = Number(value)
  return Number.isInteger(tier) && tier >= 1 && tier <= 30 ? tier : null
}

export function normalizeLean(value: unknown): RatingLean | null {
  const lean = Number(value)
  return [-2, -1, 0, 1, 2].includes(lean) ? lean as RatingLean : null
}

export function normalizeConfidence(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const confidence = Number(value)
  return Number.isFinite(confidence) && confidence >= 0 && confidence <= 1 ? confidence : null
}

export async function audit(
  db: DbClient,
  actorId: string | null,
  action: string,
  entityType: string,
  entityId: string | null,
  details: unknown,
) {
  await db.query(
    `INSERT INTO audit_log(actor_id, action, entity_type, entity_id, details)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [actorId, action, entityType, entityId, JSON.stringify(details ?? null)],
  )
}

export async function publishCanonicalRating(
  db: DbClient,
  input: {
    levelVersionId: string
    expectedLevelId?: string
    family: Family
    tier: number
    confidence: number | null
    reason: string | null
    actorId: string | null
  },
) {
  return inTransaction(db, async () => {
    const version = await db.query(
      `SELECT lv.id, lv.level_id
       FROM level_versions lv
       WHERE lv.id = $1`,
      [input.levelVersionId],
    )
    if (!version.rowCount) throw new Error('Level version not found')
    if (input.expectedLevelId && version.rows[0].level_id !== input.expectedLevelId) {
      throw new Error('Level version does not belong to requested level')
    }

    await db.query(
      `UPDATE canonical_ratings
       SET effective_to = now()
       WHERE level_version_id = $1 AND effective_to IS NULL`,
      [input.levelVersionId],
    )

    const inserted = await db.query(
      `INSERT INTO canonical_ratings(level_version_id, family, tier, confidence, reason, decided_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [input.levelVersionId, input.family, input.tier, input.confidence, input.reason, input.actorId],
    )

    const staleRefs = await db.query(
      `UPDATE difficulty_references
       SET status = 'NEEDS_REVIEW', updated_at = now()
       WHERE level_version_id = $1
         AND status = 'ACTIVE'
         AND (family <> $2 OR tier <> $3)
       RETURNING *`,
      [input.levelVersionId, input.family, input.tier],
    )

    for (const ref of staleRefs.rows) {
      await db.query(
        `INSERT INTO reference_history(reference_id, action, old_data, new_data, actor_id)
         VALUES ($1, 'AUTO_REVIEW_AFTER_RERATE', $2::jsonb, $3::jsonb, $4)`,
        [
          ref.id,
          JSON.stringify({ status: 'ACTIVE', family: ref.family, tier: ref.tier }),
          JSON.stringify({ status: 'NEEDS_REVIEW', reason: 'Canonical rating moved outside reference slot' }),
          input.actorId,
        ],
      )
    }

    await audit(db, input.actorId, 'CANONICAL_RERATE', 'level_version', input.levelVersionId, {
      family: input.family,
      tier: input.tier,
      confidence: input.confidence,
      staleReferenceIds: staleRefs.rows.map((row) => row.id),
    })

    return { rating: inserted.rows[0], staleReferenceIds: staleRefs.rows.map((row) => row.id) }
  })
}

export async function updateReferenceStatus(
  db: DbClient,
  referenceId: string,
  status: ReferenceStatus,
  actorId: string | null,
  notes?: string | null,
) {
  return inTransaction(db, async () => {
    const current = await db.query(`SELECT * FROM difficulty_references WHERE id = $1`, [referenceId])
    if (!current.rowCount) throw new Error('Reference not found')
    const oldRow = current.rows[0]
    const updated = await db.query(
      `UPDATE difficulty_references
       SET status = $2,
           notes = COALESCE($3, notes),
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [referenceId, status, notes ?? null],
    )
    await db.query(
      `INSERT INTO reference_history(reference_id, action, old_data, new_data, actor_id)
       VALUES ($1, 'STATUS_CHANGE', $2::jsonb, $3::jsonb, $4)`,
      [referenceId, JSON.stringify(oldRow), JSON.stringify(updated.rows[0]), actorId],
    )
    await audit(db, actorId, 'REFERENCE_STATUS', 'reference', referenceId, { status, notes })
    return updated.rows[0]
  })
}
