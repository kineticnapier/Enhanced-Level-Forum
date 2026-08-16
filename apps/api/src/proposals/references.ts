import type { Family, ProposalType, RatingLean, ReferenceStatus } from '@elf/shared'
import type { DbClient } from '../db'
import { audit } from '../services'

export type ReferenceProposalType = Extract<ProposalType, 'REFERENCE_ADD' | 'REFERENCE_MOVE' | 'REFERENCE_REMOVE'>

type Rating = { family: Family; tier: number }

type ReferenceSnapshot = {
  id: string
  levelVersionId: string
  family: Family
  tier: number
  technique: string
  positionHint: RatingLean | null
  status: ReferenceStatus
  confidence: number | null
  notes: string | null
}

type ReferenceTarget = {
  family: Family
  tier: number
  technique: string
  positionHint: RatingLean | null
  confidence: number | null
  notes: string | null
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export class ReferenceProposalError extends Error {
  status: 400 | 404 | 409

  constructor(status: 400 | 404 | 409, message: string) {
    super(message)
    this.status = status
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function parseRating(value: unknown): Rating | null {
  const record = asRecord(value)
  if (!record) return null
  const family = record.family
  const tier = Number(record.tier)
  if ((family === 'P' || family === 'G' || family === 'U') && Number.isInteger(tier) && tier >= 1 && tier <= 30) {
    return { family, tier }
  }
  return null
}

function parseLean(value: unknown): RatingLean | null | undefined {
  if (value === null || value === undefined || value === '') return null
  const lean = Number(value)
  if (lean === -2 || lean === -1 || lean === 0 || lean === 1 || lean === 2) return lean
  return undefined
}

function parseConfidence(value: unknown): number | null | undefined {
  if (value === null || value === undefined || value === '') return null
  const confidence = Number(value)
  if (Number.isFinite(confidence) && confidence >= 0 && confidence <= 1) return confidence
  return undefined
}

function sameRating(a: Rating | null, b: Rating | null): boolean {
  if (!a || !b) return a === null && b === null
  return a.family === b.family && a.tier === b.tier
}

function ratingText(rating: Rating | null): string {
  return rating ? `${rating.family}${rating.tier}` : 'Unrated'
}

function rowRating(row: any): Rating | null {
  return row.canonical_family
    ? { family: row.canonical_family as Family, tier: Number(row.canonical_tier) }
    : null
}

function snapshotFromRow(row: any): ReferenceSnapshot {
  return {
    id: row.id,
    levelVersionId: row.level_version_id,
    family: row.family as Family,
    tier: Number(row.tier),
    technique: row.technique,
    positionHint: row.position_hint === null ? null : Number(row.position_hint) as RatingLean,
    status: row.status as ReferenceStatus,
    confidence: row.confidence === null ? null : Number(row.confidence),
    notes: row.notes ?? null,
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

async function readReference(db: DbClient, referenceId: string, lock = false) {
  const result = await db.query(
    `SELECT r.*,lv.level_id,cr.family AS canonical_family,cr.tier AS canonical_tier
     FROM difficulty_references r
     JOIN level_versions lv ON lv.id=r.level_version_id
     LEFT JOIN canonical_ratings cr ON cr.level_version_id=r.level_version_id AND cr.effective_to IS NULL
     WHERE r.id=$1
     ${lock ? 'FOR UPDATE OF r' : ''}`,
    [referenceId],
  )
  return result.rows[0] ?? null
}

function parseRequestedTarget(value: unknown, fallback?: ReferenceSnapshot): ReferenceTarget | null {
  const record = asRecord(value)
  if (!record) return null
  const rating = parseRating(record)
  const techniqueRaw = typeof record.technique === 'string' ? record.technique.trim().toUpperCase() : fallback?.technique ?? ''
  const positionHint = parseLean(record.positionHint === undefined ? fallback?.positionHint : record.positionHint)
  const confidence = parseConfidence(record.confidence === undefined ? fallback?.confidence : record.confidence)
  const notes = record.notes === undefined ? fallback?.notes ?? null : record.notes === null ? null : typeof record.notes === 'string' ? record.notes : undefined
  if (!rating || !techniqueRaw || positionHint === undefined || confidence === undefined || notes === undefined) return null
  return { ...rating, technique: techniqueRaw, positionHint, confidence, notes }
}

function parseStoredSnapshot(value: unknown): ReferenceSnapshot | null {
  const record = asRecord(value)
  if (!record || typeof record.id !== 'string' || typeof record.levelVersionId !== 'string' || !UUID_RE.test(record.id) || !UUID_RE.test(record.levelVersionId)) return null
  const target = parseRequestedTarget(record)
  const status = record.status
  if (!target || (status !== 'ACTIVE' && status !== 'NEEDS_REVIEW' && status !== 'RETIRED')) return null
  return { id: record.id, levelVersionId: record.levelVersionId, ...target, status }
}

async function requireVersionAndCanonical(db: DbClient, levelId: string, levelVersionId: string) {
  if (!UUID_RE.test(levelVersionId)) throw new ReferenceProposalError(400, 'levelVersionId must be a UUID')
  const version = await db.query(
    `SELECT lv.id,lv.level_id,cr.family AS canonical_family,cr.tier AS canonical_tier
     FROM level_versions lv
     LEFT JOIN canonical_ratings cr ON cr.level_version_id=lv.id AND cr.effective_to IS NULL
     WHERE lv.id=$1 AND lv.level_id=$2`,
    [levelVersionId, levelId],
  )
  if (!version.rowCount) throw new ReferenceProposalError(404, 'LevelVersion not found for this Level')
  return { row: version.rows[0], canonical: rowRating(version.rows[0]) }
}

export async function prepareReferenceProposalPayload(
  db: DbClient,
  input: { type: ReferenceProposalType; levelId: string; payload: unknown },
): Promise<Record<string, unknown>> {
  const requested = asRecord(input.payload) ?? {}

  if (input.type === 'REFERENCE_ADD') {
    const levelVersionId = typeof requested.levelVersionId === 'string' ? requested.levelVersionId : ''
    const reference = parseRequestedTarget(requested.reference)
    if (!UUID_RE.test(levelVersionId) || !reference) {
      throw new ReferenceProposalError(400, 'REFERENCE_ADD requires levelVersionId and a valid reference {family,tier,technique,positionHint?,confidence?,notes?}')
    }
    const { canonical } = await requireVersionAndCanonical(db, input.levelId, levelVersionId)
    const targetRating = { family: reference.family, tier: reference.tier }
    if (!canonical || !sameRating(canonical, targetRating)) {
      throw new ReferenceProposalError(409, `Reference add target ${ratingText(targetRating)} does not match current canonical ${ratingText(canonical)}`)
    }
    const duplicate = await db.query(
      `SELECT id FROM difficulty_references
       WHERE level_version_id=$1 AND family=$2 AND tier=$3 AND technique=$4 AND status<>'RETIRED'
       LIMIT 1`,
      [levelVersionId, reference.family, reference.tier, reference.technique],
    )
    if (duplicate.rowCount) throw new ReferenceProposalError(409, 'A non-retired Reference already exists for this Version/slot/technique')
    return {
      targetLevelVersionId: levelVersionId,
      currentCanonicalRating: canonical,
      reference,
    }
  }

  const referenceId = typeof requested.referenceId === 'string' ? requested.referenceId : ''
  if (!UUID_RE.test(referenceId)) throw new ReferenceProposalError(400, `${input.type} requires referenceId`)
  const row = await readReference(db, referenceId)
  if (!row || row.level_id !== input.levelId) throw new ReferenceProposalError(404, 'Reference not found for this Level')
  const baseline = snapshotFromRow(row)
  if (baseline.status === 'RETIRED') throw new ReferenceProposalError(409, 'Retired Reference cannot be changed by a new proposal')

  if (input.type === 'REFERENCE_REMOVE') {
    return {
      referenceId,
      targetLevelVersionId: baseline.levelVersionId,
      baselineReference: baseline,
    }
  }

  const target = parseRequestedTarget(requested.target, baseline)
  if (!target) throw new ReferenceProposalError(400, 'REFERENCE_MOVE requires target {family,tier,positionHint?}')
  if (target.technique !== baseline.technique || target.confidence !== baseline.confidence || target.notes !== baseline.notes) {
    throw new ReferenceProposalError(400, 'REFERENCE_MOVE changes slot/position only; technique, confidence, and notes remain unchanged')
  }
  const canonical = rowRating(row)
  const targetRating = { family: target.family, tier: target.tier }
  if (!canonical || !sameRating(canonical, targetRating)) {
    throw new ReferenceProposalError(409, `Reference move target ${ratingText(targetRating)} does not match current canonical ${ratingText(canonical)}`)
  }
  if (baseline.family === target.family && baseline.tier === target.tier && baseline.positionHint === target.positionHint && baseline.status === 'ACTIVE') {
    throw new ReferenceProposalError(409, 'REFERENCE_MOVE is a no-op')
  }
  const duplicate = await db.query(
    `SELECT id FROM difficulty_references
     WHERE level_version_id=$1 AND family=$2 AND tier=$3 AND technique=$4 AND status<>'RETIRED' AND id<>$5
     LIMIT 1`,
    [baseline.levelVersionId, target.family, target.tier, target.technique, referenceId],
  )
  if (duplicate.rowCount) throw new ReferenceProposalError(409, 'Another non-retired Reference already occupies the target Version/slot/technique')
  return {
    referenceId,
    targetLevelVersionId: baseline.levelVersionId,
    currentCanonicalRating: canonical,
    baselineReference: baseline,
    targetReference: target,
  }
}

async function lockVersionCanonical(db: DbClient, levelId: string, levelVersionId: string): Promise<Rating | null> {
  const version = await db.query(
    `SELECT id FROM level_versions WHERE id=$1 AND level_id=$2 FOR UPDATE`,
    [levelVersionId, levelId],
  )
  if (!version.rowCount) throw new ReferenceProposalError(409, 'Proposal target LevelVersion no longer belongs to this Level')
  const canonical = await db.query(
    `SELECT family,tier FROM canonical_ratings
     WHERE level_version_id=$1 AND effective_to IS NULL
     FOR UPDATE`,
    [levelVersionId],
  )
  return canonical.rowCount
    ? { family: canonical.rows[0].family as Family, tier: Number(canonical.rows[0].tier) }
    : null
}

export async function executeReferenceProposalInTransaction(
  db: DbClient,
  input: { proposal: any; actorId: string },
) {
  const proposal = input.proposal
  const payload = asRecord(proposal.payload) ?? {}
  const type = proposal.type as ReferenceProposalType

  if (type === 'REFERENCE_ADD') {
    const targetLevelVersionId = typeof payload.targetLevelVersionId === 'string' ? payload.targetLevelVersionId : ''
    const baselineCanonicalPresent = Object.prototype.hasOwnProperty.call(payload, 'currentCanonicalRating')
    const baselineCanonical = payload.currentCanonicalRating === null ? null : parseRating(payload.currentCanonicalRating)
    const reference = parseRequestedTarget(payload.reference)
    if (!UUID_RE.test(targetLevelVersionId) || !baselineCanonicalPresent || !baselineCanonical || !reference) {
      throw new ReferenceProposalError(409, 'REFERENCE_ADD proposal payload cannot be executed safely')
    }
    const currentCanonical = await lockVersionCanonical(db, proposal.level_id, targetLevelVersionId)
    const targetRating = { family: reference.family, tier: reference.tier }
    if (!sameRating(currentCanonical, baselineCanonical) || !sameRating(currentCanonical, targetRating)) {
      throw new ReferenceProposalError(409, `Reference proposal baseline is stale: expected ${ratingText(baselineCanonical)}, current canonical is ${ratingText(currentCanonical)}`)
    }
    const inserted = await db.query(
      `INSERT INTO difficulty_references(level_version_id,family,tier,technique,position_hint,status,confidence,notes,created_by)
       VALUES ($1,$2,$3,$4,$5,'ACTIVE',$6,$7,$8)
       ON CONFLICT DO NOTHING
       RETURNING *`,
      [targetLevelVersionId, reference.family, reference.tier, reference.technique, reference.positionHint, reference.confidence, reference.notes, input.actorId],
    )
    if (!inserted.rowCount) throw new ReferenceProposalError(409, 'Reference add target is no longer available')
    const created = inserted.rows[0]
    await db.query(
      `INSERT INTO reference_history(reference_id,action,new_data,actor_id)
       VALUES ($1,'PROPOSAL_ADD',$2::jsonb,$3)`,
      [created.id, JSON.stringify({ ...created, proposalId: proposal.id }), input.actorId],
    )
    await audit(db, input.actorId, 'REFERENCE_CREATE', 'reference', created.id, { source: 'PROPOSAL', proposalId: proposal.id })
    return { type, referenceId: created.id, reference: snapshotFromRow(created) }
  }

  const referenceId = typeof payload.referenceId === 'string' ? payload.referenceId : ''
  const baseline = parseStoredSnapshot(payload.baselineReference)
  if (!UUID_RE.test(referenceId) || !baseline || baseline.id !== referenceId) {
    throw new ReferenceProposalError(409, `${type} proposal payload cannot be executed safely`)
  }
  const currentRow = await readReference(db, referenceId, true)
  if (!currentRow || currentRow.level_id !== proposal.level_id) throw new ReferenceProposalError(409, 'Reference no longer belongs to this Level')
  const current = snapshotFromRow(currentRow)
  if (!sameReference(current, baseline)) {
    throw new ReferenceProposalError(409, 'Reference proposal baseline is stale: the Reference changed after proposal creation')
  }

  if (type === 'REFERENCE_REMOVE') {
    const updated = await db.query(
      `UPDATE difficulty_references SET status='RETIRED',updated_at=now() WHERE id=$1 RETURNING *`,
      [referenceId],
    )
    await db.query(
      `INSERT INTO reference_history(reference_id,action,old_data,new_data,actor_id)
       VALUES ($1,'PROPOSAL_REMOVE',$2::jsonb,$3::jsonb,$4)`,
      [referenceId, JSON.stringify(currentRow), JSON.stringify({ ...updated.rows[0], proposalId: proposal.id }), input.actorId],
    )
    await audit(db, input.actorId, 'REFERENCE_REMOVE', 'reference', referenceId, { source: 'PROPOSAL', proposalId: proposal.id })
    return { type, referenceId, previousReference: baseline, reference: snapshotFromRow(updated.rows[0]) }
  }

  const targetLevelVersionId = typeof payload.targetLevelVersionId === 'string' ? payload.targetLevelVersionId : ''
  const baselineCanonicalPresent = Object.prototype.hasOwnProperty.call(payload, 'currentCanonicalRating')
  const baselineCanonical = payload.currentCanonicalRating === null ? null : parseRating(payload.currentCanonicalRating)
  const target = parseRequestedTarget(payload.targetReference, baseline)
  if (!UUID_RE.test(targetLevelVersionId) || targetLevelVersionId !== baseline.levelVersionId || !baselineCanonicalPresent || !baselineCanonical || !target) {
    throw new ReferenceProposalError(409, 'REFERENCE_MOVE proposal payload cannot be executed safely')
  }
  if (target.technique !== baseline.technique || target.confidence !== baseline.confidence || target.notes !== baseline.notes) {
    throw new ReferenceProposalError(409, 'REFERENCE_MOVE proposal attempted to change immutable fields')
  }
  const currentCanonical = await lockVersionCanonical(db, proposal.level_id, targetLevelVersionId)
  const targetRating = { family: target.family, tier: target.tier }
  if (!sameRating(currentCanonical, baselineCanonical) || !sameRating(currentCanonical, targetRating)) {
    throw new ReferenceProposalError(409, `Reference proposal baseline is stale: expected ${ratingText(baselineCanonical)}, current canonical is ${ratingText(currentCanonical)}`)
  }
  const conflict = await db.query(
    `SELECT id FROM difficulty_references
     WHERE level_version_id=$1 AND family=$2 AND tier=$3 AND technique=$4 AND status<>'RETIRED' AND id<>$5
     LIMIT 1`,
    [targetLevelVersionId, target.family, target.tier, target.technique, referenceId],
  )
  if (conflict.rowCount) throw new ReferenceProposalError(409, 'Another non-retired Reference now occupies the target Version/slot/technique')

  const updated = await db.query(
    `UPDATE difficulty_references
     SET family=$2,tier=$3,position_hint=$4,status='ACTIVE',updated_at=now()
     WHERE id=$1 RETURNING *`,
    [referenceId, target.family, target.tier, target.positionHint],
  )
  await db.query(
    `INSERT INTO reference_history(reference_id,action,old_data,new_data,actor_id)
     VALUES ($1,'PROPOSAL_MOVE',$2::jsonb,$3::jsonb,$4)`,
    [referenceId, JSON.stringify(currentRow), JSON.stringify({ ...updated.rows[0], proposalId: proposal.id }), input.actorId],
  )
  await audit(db, input.actorId, 'REFERENCE_MOVE', 'reference', referenceId, {
    source: 'PROPOSAL',
    proposalId: proposal.id,
    from: { family: baseline.family, tier: baseline.tier, positionHint: baseline.positionHint },
    to: { family: target.family, tier: target.tier, positionHint: target.positionHint },
  })
  return { type, referenceId, previousReference: baseline, reference: snapshotFromRow(updated.rows[0]) }
}
