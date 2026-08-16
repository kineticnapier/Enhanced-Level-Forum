import type { Family } from '@elf/shared'
import type { DbClient } from '../db'
import { inTransaction } from '../db'
import { audit, publishCanonicalRatingInTransaction } from '../services'

export class ProposalDecisionError extends Error {
  status: 400 | 404 | 409

  constructor(status: 400 | 404 | 409, message: string) {
    super(message)
    this.status = status
  }
}

type Rating = { family: Family; tier: number }
type DecisionStatus = 'APPROVED' | 'REJECTED' | 'WITHDRAWN'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function parseRating(value: unknown): Rating | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const family = record.family
  const tier = Number(record.tier)
  if ((family === 'P' || family === 'G' || family === 'U') && Number.isInteger(tier) && tier >= 1 && tier <= 30) {
    return { family, tier }
  }
  return null
}

function sameRating(a: Rating | null, b: Rating | null): boolean {
  if (!a || !b) return a === null && b === null
  return a.family === b.family && a.tier === b.tier
}

function ratingText(value: Rating | null): string {
  return value ? `${value.family}${value.tier}` : 'Unrated'
}

async function finishDecision(
  db: DbClient,
  input: {
    proposalId: string
    status: DecisionStatus
    reason: string | null
    actorId: string
    auditDetails?: Record<string, unknown>
  },
) {
  const result = await db.query(
    `UPDATE proposals
     SET status=$2, decision_reason=$3, decided_by=$4, decided_at=now(), updated_at=now()
     WHERE id=$1 AND status='OPEN'
     RETURNING *`,
    [input.proposalId, input.status, input.reason, input.actorId],
  )
  if (!result.rowCount) throw new ProposalDecisionError(404, 'Open proposal not found')

  await audit(db, input.actorId, 'PROPOSAL_DECISION', 'proposal', input.proposalId, {
    status: input.status,
    reason: input.reason,
    ...(input.auditDetails ?? {}),
  })
  return result.rows[0]
}

export async function decideProposal(
  db: DbClient,
  input: {
    proposalId: string
    status: DecisionStatus
    reason: string | null
    actorId: string
  },
) {
  return inTransaction(db, async () => {
    const proposalResult = await db.query(
      `SELECT * FROM proposals WHERE id=$1 AND status='OPEN' FOR UPDATE`,
      [input.proposalId],
    )
    if (!proposalResult.rowCount) throw new ProposalDecisionError(404, 'Open proposal not found')
    const proposal = proposalResult.rows[0]

    if (input.status !== 'APPROVED' || proposal.type !== 'RERATE') {
      const decided = await finishDecision(db, {
        ...input,
        auditDetails: { execution: 'STATUS_ONLY', proposalType: proposal.type },
      })
      return { proposal: decided, execution: null }
    }

    const payload = proposal.payload && typeof proposal.payload === 'object'
      ? proposal.payload as Record<string, unknown>
      : {}
    const targetLevelVersionId = typeof payload.targetLevelVersionId === 'string'
      ? payload.targetLevelVersionId
      : ''
    const proposedRating = parseRating(payload.proposedRating)
    const baselinePresent = Object.prototype.hasOwnProperty.call(payload, 'currentCanonicalRating')
    const baselineRating = payload.currentCanonicalRating === null ? null : parseRating(payload.currentCanonicalRating)

    if (!UUID_RE.test(targetLevelVersionId) || !proposedRating || !baselinePresent || (payload.currentCanonicalRating !== null && !baselineRating)) {
      throw new ProposalDecisionError(
        409,
        'RERATE proposal payload cannot be executed safely; target version, baseline rating, and proposed rating are required',
      )
    }
    if (sameRating(baselineRating, proposedRating)) {
      throw new ProposalDecisionError(409, 'RERATE proposal is a no-op and cannot be executed')
    }

    const versionResult = await db.query(
      `SELECT lv.id,lv.level_id,lv.label
       FROM level_versions lv
       WHERE lv.id=$1 AND lv.level_id=$2
       FOR UPDATE`,
      [targetLevelVersionId, proposal.level_id],
    )
    if (!versionResult.rowCount) {
      throw new ProposalDecisionError(409, 'Proposal target LevelVersion no longer belongs to this Level')
    }

    const currentResult = await db.query(
      `SELECT id,family,tier
       FROM canonical_ratings
       WHERE level_version_id=$1 AND effective_to IS NULL
       FOR UPDATE`,
      [targetLevelVersionId],
    )
    const currentRating: Rating | null = currentResult.rowCount
      ? { family: currentResult.rows[0].family as Family, tier: Number(currentResult.rows[0].tier) }
      : null

    if (!sameRating(currentRating, baselineRating)) {
      throw new ProposalDecisionError(
        409,
        `Proposal baseline is stale: expected ${ratingText(baselineRating)}, current canonical is ${ratingText(currentRating)}`,
      )
    }

    const rerate = await publishCanonicalRatingInTransaction(db, {
      levelVersionId: targetLevelVersionId,
      expectedLevelId: proposal.level_id,
      family: proposedRating.family,
      tier: proposedRating.tier,
      confidence: null,
      reason: proposal.reason,
      actorId: input.actorId,
    })

    const decided = await finishDecision(db, {
      ...input,
      auditDetails: {
        execution: 'RERATE_APPLIED',
        targetLevelVersionId,
        baselineRating,
        proposedRating,
        canonicalRatingId: rerate.rating.id,
        staleReferenceIds: rerate.staleReferenceIds,
      },
    })

    await audit(db, input.actorId, 'PROPOSAL_EXECUTION', 'proposal', input.proposalId, {
      type: 'RERATE',
      targetLevelVersionId,
      baselineRating,
      proposedRating,
      canonicalRatingId: rerate.rating.id,
      staleReferenceIds: rerate.staleReferenceIds,
    })

    return {
      proposal: decided,
      execution: {
        type: 'RERATE' as const,
        targetLevelVersionId,
        previousRating: baselineRating,
        rating: rerate.rating,
        staleReferenceIds: rerate.staleReferenceIds,
      },
    }
  })
}
