import type { Family, ProposalType, ReferenceStatus } from '@elf/shared'
import type { DbClient } from '../db'

type Rating = { family: Family; tier: number }
type ProposalLike = { id: string; type: ProposalType; status: string; level_id?: string; levelId?: string; payload: unknown }
type ExecutionState = 'READY' | 'STALE' | 'INCOMPLETE' | 'STATUS_ONLY' | 'CLOSED'

type ReferenceSnapshot = {
  id: string
  levelVersionId: string
  family: Family
  tier: number
  technique: string
  positionHint: number | null
  status: ReferenceStatus
  confidence: number | null
  notes: string | null
}

export type ProposalInspection = { state: ExecutionState; message: string }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function rating(value: unknown): Rating | null {
  const valueRecord = record(value)
  if (!valueRecord) return null
  const family = valueRecord.family
  const tier = Number(valueRecord.tier)
  if ((family === 'P' || family === 'G' || family === 'U') && Number.isInteger(tier) && tier >= 1 && tier <= 30) {
    return { family, tier }
  }
  return null
}

function sameRating(a: Rating | null, b: Rating | null): boolean {
  if (!a || !b) return a === null && b === null
  return a.family === b.family && a.tier === b.tier
}

function referenceSnapshot(value: unknown): ReferenceSnapshot | null {
  const valueRecord = record(value)
  if (!valueRecord || typeof valueRecord.id !== 'string' || typeof valueRecord.levelVersionId !== 'string') return null
  const parsedRating = rating(valueRecord)
  const status = valueRecord.status
  const positionHint = valueRecord.positionHint === null ? null : Number(valueRecord.positionHint)
  const confidence = valueRecord.confidence === null ? null : Number(valueRecord.confidence)
  if (!parsedRating || !UUID_RE.test(valueRecord.id) || !UUID_RE.test(valueRecord.levelVersionId)) return null
  if (status !== 'ACTIVE' && status !== 'NEEDS_REVIEW' && status !== 'RETIRED') return null
  if (positionHint !== null && ![-2, -1, 0, 1, 2].includes(positionHint)) return null
  if (confidence !== null && (!Number.isFinite(confidence) || confidence < 0 || confidence > 1)) return null
  if (typeof valueRecord.technique !== 'string') return null
  if (valueRecord.notes !== null && valueRecord.notes !== undefined && typeof valueRecord.notes !== 'string') return null
  return {
    id: valueRecord.id,
    levelVersionId: valueRecord.levelVersionId,
    ...parsedRating,
    technique: valueRecord.technique,
    positionHint,
    status,
    confidence,
    notes: typeof valueRecord.notes === 'string' ? valueRecord.notes : null,
  }
}

function sameReference(a: ReferenceSnapshot, b: ReferenceSnapshot): boolean {
  return a.id === b.id
    && a.levelVersionId === b.levelVersionId
    && a.family === b.family
    && a.tier === b.tier
    && a.technique === b.technique
    && a.positionHint === b.positionHint
    && a.status === b.status
    && a.confidence === b.confidence
    && a.notes === b.notes
}

function proposalLevelId(proposal: ProposalLike): string {
  return proposal.level_id ?? proposal.levelId ?? ''
}

export async function inspectProposalRows(db: DbClient, proposals: ProposalLike[]): Promise<Map<string, ProposalInspection>> {
  const result = new Map<string, ProposalInspection>()
  const versionIds = new Set<string>()
  const referenceIds = new Set<string>()

  for (const proposal of proposals) {
    if (proposal.status !== 'OPEN') {
      result.set(proposal.id, { state: 'CLOSED', message: `Proposal is ${proposal.status.toLowerCase()}.` })
      continue
    }
    if (proposal.type === 'METADATA' || proposal.type === 'OTHER') {
      result.set(proposal.id, { state: 'STATUS_ONLY', message: 'Approval records a governance decision; there is no automatic database mutation for this proposal type.' })
      continue
    }
    const payload = record(proposal.payload)
    if (!payload) continue
    const versionId = typeof payload.targetLevelVersionId === 'string' ? payload.targetLevelVersionId : ''
    const referenceId = typeof payload.referenceId === 'string' ? payload.referenceId : ''
    if (UUID_RE.test(versionId)) versionIds.add(versionId)
    if (UUID_RE.test(referenceId)) referenceIds.add(referenceId)
  }

  const versionMap = new Map<string, { levelId: string; rating: Rating | null }>()
  if (versionIds.size) {
    const rows = await db.query(
      `SELECT lv.id,lv.level_id,cr.family,cr.tier
       FROM level_versions lv
       LEFT JOIN canonical_ratings cr ON cr.level_version_id=lv.id AND cr.effective_to IS NULL
       WHERE lv.id = ANY($1::uuid[])`,
      [[...versionIds]],
    )
    for (const row of rows.rows) {
      versionMap.set(row.id, {
        levelId: row.level_id,
        rating: row.family ? { family: row.family as Family, tier: Number(row.tier) } : null,
      })
    }
  }

  const referenceMap = new Map<string, { levelId: string; snapshot: ReferenceSnapshot }>()
  if (referenceIds.size) {
    const rows = await db.query(
      `SELECT r.id,r.level_version_id,r.family,r.tier,r.technique,r.position_hint,r.status,r.confidence,r.notes,lv.level_id
       FROM difficulty_references r
       JOIN level_versions lv ON lv.id=r.level_version_id
       WHERE r.id = ANY($1::uuid[])`,
      [[...referenceIds]],
    )
    for (const row of rows.rows) {
      referenceMap.set(row.id, {
        levelId: row.level_id,
        snapshot: {
          id: row.id,
          levelVersionId: row.level_version_id,
          family: row.family as Family,
          tier: Number(row.tier),
          technique: row.technique,
          positionHint: row.position_hint === null ? null : Number(row.position_hint),
          status: row.status as ReferenceStatus,
          confidence: row.confidence === null ? null : Number(row.confidence),
          notes: row.notes ?? null,
        },
      })
    }
  }

  for (const proposal of proposals) {
    if (result.has(proposal.id)) continue
    const payload = record(proposal.payload)
    const levelId = proposalLevelId(proposal)
    if (!payload) {
      result.set(proposal.id, { state: 'INCOMPLETE', message: 'Proposal payload is not executable.' })
      continue
    }

    if (proposal.type === 'RERATE') {
      const versionId = typeof payload.targetLevelVersionId === 'string' ? payload.targetLevelVersionId : ''
      const baselinePresent = Object.prototype.hasOwnProperty.call(payload, 'currentCanonicalRating')
      const baseline = payload.currentCanonicalRating === null ? null : rating(payload.currentCanonicalRating)
      const proposed = rating(payload.proposedRating)
      const current = versionMap.get(versionId)
      if (!UUID_RE.test(versionId) || !baselinePresent || (payload.currentCanonicalRating !== null && !baseline) || !proposed) {
        result.set(proposal.id, { state: 'INCOMPLETE', message: 'RERATE proposal is missing a safe target, baseline, or proposed rating.' })
      } else if (!current || current.levelId !== levelId) {
        result.set(proposal.id, { state: 'STALE', message: 'Target LevelVersion no longer belongs to this Level.' })
      } else if (!sameRating(current.rating, baseline)) {
        result.set(proposal.id, { state: 'STALE', message: `Canonical rating changed after proposal creation.` })
      } else if (sameRating(current.rating, proposed)) {
        result.set(proposal.id, { state: 'STALE', message: 'The proposed rating is already canonical.' })
      } else {
        result.set(proposal.id, { state: 'READY', message: 'Baseline still matches current canonical state.' })
      }
      continue
    }

    if (proposal.type === 'REFERENCE_ADD') {
      const versionId = typeof payload.targetLevelVersionId === 'string' ? payload.targetLevelVersionId : ''
      const baseline = rating(payload.currentCanonicalRating)
      const target = rating(payload.reference)
      const current = versionMap.get(versionId)
      if (!UUID_RE.test(versionId) || !baseline || !target) {
        result.set(proposal.id, { state: 'INCOMPLETE', message: 'REFERENCE_ADD proposal is missing a safe target or canonical baseline.' })
      } else if (!current || current.levelId !== levelId) {
        result.set(proposal.id, { state: 'STALE', message: 'Target LevelVersion no longer belongs to this Level.' })
      } else if (!sameRating(current.rating, baseline) || !sameRating(current.rating, target)) {
        result.set(proposal.id, { state: 'STALE', message: 'Canonical slot changed after the Reference proposal was created.' })
      } else {
        result.set(proposal.id, { state: 'READY', message: 'Reference target still matches the canonical slot.' })
      }
      continue
    }

    const referenceId = typeof payload.referenceId === 'string' ? payload.referenceId : ''
    const baseline = referenceSnapshot(payload.baselineReference)
    const currentReference = referenceMap.get(referenceId)
    if (!UUID_RE.test(referenceId) || !baseline || baseline.id !== referenceId) {
      result.set(proposal.id, { state: 'INCOMPLETE', message: `${proposal.type} proposal is missing a safe Reference baseline.` })
      continue
    }
    if (!currentReference || currentReference.levelId !== levelId) {
      result.set(proposal.id, { state: 'STALE', message: 'Reference no longer belongs to this Level.' })
      continue
    }
    if (!sameReference(currentReference.snapshot, baseline)) {
      result.set(proposal.id, { state: 'STALE', message: 'Reference changed after proposal creation.' })
      continue
    }

    if (proposal.type === 'REFERENCE_MOVE') {
      const versionId = typeof payload.targetLevelVersionId === 'string' ? payload.targetLevelVersionId : ''
      const baselineCanonical = rating(payload.currentCanonicalRating)
      const target = rating(payload.targetReference)
      const currentVersion = versionMap.get(versionId)
      if (!UUID_RE.test(versionId) || !baselineCanonical || !target || !currentVersion || currentVersion.levelId !== levelId) {
        result.set(proposal.id, { state: 'INCOMPLETE', message: 'REFERENCE_MOVE proposal is missing a safe canonical target.' })
      } else if (!sameRating(currentVersion.rating, baselineCanonical) || !sameRating(currentVersion.rating, target)) {
        result.set(proposal.id, { state: 'STALE', message: 'Canonical slot changed after the Reference move was proposed.' })
      } else {
        result.set(proposal.id, { state: 'READY', message: 'Reference and canonical baselines still match.' })
      }
      continue
    }

    if (proposal.type === 'REFERENCE_REMOVE') {
      result.set(proposal.id, { state: 'READY', message: 'Reference baseline still matches current state.' })
      continue
    }

    result.set(proposal.id, { state: 'STATUS_ONLY', message: 'This proposal type has no automatic execution.' })
  }

  return result
}
