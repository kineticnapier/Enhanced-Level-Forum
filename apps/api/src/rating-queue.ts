import type { Hono } from 'hono'
import type { Family, RatingLean } from '@elf/shared'
import { hasRole, loadUser, requireRole, type AppBindings } from './auth'
import { inTransaction, withDb, type DbClient } from './db'
import { audit, normalizeFamily, normalizeLean, normalizeTier } from './services'

const MAX_ACTIVE_QUEUE_ITEMS = 30
const MAX_ACTIVE_CLAIMS_PER_RATER = 5
const CONSENSUS_SPREAD = 0.8

type VoteRow = {
  family: Family
  anchor_tier: number
  lean: RatingLean
}

type ReviewAssessment = {
  status: 'OPEN' | 'REVIEW_READY'
  reason: 'NEED_MORE' | 'CONSENSUS' | 'DISAGREEMENT_NEEDS_ONE_MORE' | 'DISAGREEMENT'
  voteCount: number
  candidate: { family: Family; tier: number } | null
  spread: number | null
}

type RatingInput = {
  family?: unknown
  anchorTier?: unknown
  lean?: unknown
  confidence?: unknown
  comment?: unknown
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  const upper = sorted[middle]!
  if (sorted.length % 2) return upper
  const lower = sorted[middle - 1]!
  return (lower + upper) / 2
}

function assessVotes(votes: VoteRow[], minVotes: number, maxVotes: number): ReviewAssessment {
  const voteCount = votes.length
  if (voteCount < minVotes) {
    return { status: 'OPEN', reason: 'NEED_MORE', voteCount, candidate: null, spread: null }
  }

  const families = new Set(votes.map((vote) => vote.family))
  const scores = votes.map((vote) => Number(vote.anchor_tier) + Number(vote.lean) * 0.2)
  const spread = Math.max(...scores) - Math.min(...scores)
  const sameFamily = families.size === 1
  const candidate = sameFamily
    ? {
        family: votes[0]!.family,
        tier: Math.min(30, Math.max(1, Math.round(median(scores)))),
      }
    : null

  if (sameFamily && spread <= CONSENSUS_SPREAD) {
    return { status: 'REVIEW_READY', reason: 'CONSENSUS', voteCount, candidate, spread }
  }

  if (voteCount >= maxVotes) {
    return { status: 'REVIEW_READY', reason: 'DISAGREEMENT', voteCount, candidate, spread }
  }

  return { status: 'OPEN', reason: 'DISAGREEMENT_NEEDS_ONE_MORE', voteCount, candidate, spread }
}

function parseRatingInput(body: RatingInput) {
  const family = normalizeFamily(body.family)
  const anchorTier = normalizeTier(body.anchorTier)
  const lean = normalizeLean(body.lean)
  const confidence = Number(body.confidence ?? 3)
  const comment = typeof body.comment === 'string' ? body.comment.trim() || null : null
  if (!family || anchorTier === null || lean === null || !Number.isInteger(confidence) || confidence < 1 || confidence > 5) {
    return null
  }
  if (comment && comment.length > 4000) return null
  return { family, anchorTier, lean, confidence, comment }
}

async function assessVersion(db: DbClient, levelVersionId: string, minVotes: number, maxVotes: number): Promise<ReviewAssessment> {
  const result = await db.query(
    `SELECT family,anchor_tier,lean
     FROM rating_votes
     WHERE level_version_id=$1
     ORDER BY updated_at,id`,
    [levelVersionId],
  )
  return assessVotes(result.rows as VoteRow[], minVotes, maxVotes)
}

async function refreshQueueItem(db: DbClient, queueItemId: string) {
  const locked = await db.query(
    `SELECT id,level_version_id,status,min_votes,max_votes
     FROM rating_queue_items
     WHERE id=$1
     FOR UPDATE`,
    [queueItemId],
  )
  if (!locked.rowCount || locked.rows[0].status === 'CLOSED') return null
  const item = locked.rows[0]
  const assessment = await assessVersion(db, item.level_version_id, Number(item.min_votes), Number(item.max_votes))
  await db.query(
    `UPDATE rating_queue_items
     SET status=$2,
         review_ready_at=CASE WHEN $2='REVIEW_READY' THEN COALESCE(review_ready_at,now()) ELSE NULL END,
         updated_at=now()
     WHERE id=$1`,
    [queueItemId, assessment.status],
  )
  return assessment
}

function queueRow(row: any, assessment: ReviewAssessment | null) {
  return {
    id: row.id,
    levelId: row.level_id,
    levelVersionId: row.level_version_id,
    versionLabel: row.version_label,
    sha256: row.sha256 ?? null,
    downloadUrl: row.download_url ?? null,
    videoUrl: row.video_url ?? null,
    song: row.song,
    artist: row.artist,
    creator: row.creator,
    effecter: row.effecter ?? null,
    status: row.status,
    minVotes: Number(row.min_votes),
    maxVotes: Number(row.max_votes),
    priority: Number(row.priority),
    voteCount: Number(row.vote_count ?? assessment?.voteCount ?? 0),
    activeClaimCount: Number(row.active_claim_count ?? 0),
    myClaimStatus: row.my_claim_status ?? null,
    myVoteSubmitted: row.my_vote_submitted === true,
    openedAt: row.opened_at,
    reviewReadyAt: row.review_ready_at ?? null,
    review: assessment ? {
      reason: assessment.reason,
      candidate: assessment.candidate,
      spread: assessment.spread,
    } : null,
  }
}

async function listQueue(db: DbClient, userId: string, includeReviewReady: boolean) {
  const statuses = includeReviewReady ? ['OPEN', 'REVIEW_READY'] : ['OPEN']
  const result = await db.query(
    `SELECT q.id,q.level_version_id,q.status,q.min_votes,q.max_votes,q.priority,q.opened_at,q.review_ready_at,
            lv.level_id,lv.label AS version_label,lv.sha256,lv.download_url,lv.video_url,
            l.song,l.artist,l.creator,l.effecter,
            (SELECT count(*)::int FROM rating_votes rv WHERE rv.level_version_id=q.level_version_id) AS vote_count,
            (SELECT count(*)::int FROM rating_queue_claims qc WHERE qc.queue_item_id=q.id AND qc.status='ACTIVE') AS active_claim_count,
            mine.status AS my_claim_status,
            EXISTS(SELECT 1 FROM rating_votes rv WHERE rv.level_version_id=q.level_version_id AND rv.user_id=$1) AS my_vote_submitted
     FROM rating_queue_items q
     JOIN level_versions lv ON lv.id=q.level_version_id
     JOIN levels l ON l.id=lv.level_id
     LEFT JOIN rating_queue_claims mine ON mine.queue_item_id=q.id AND mine.user_id=$1
     WHERE q.status=ANY($2::text[]) AND l.status<>'ARCHIVED'
     ORDER BY CASE q.status WHEN 'REVIEW_READY' THEN 0 ELSE 1 END,q.priority DESC,q.opened_at,q.id`,
    [userId, statuses],
  )

  const items = []
  for (const row of result.rows) {
    const assessment = includeReviewReady
      ? await assessVersion(db, row.level_version_id, Number(row.min_votes), Number(row.max_votes))
      : null
    items.push(queueRow(row, assessment))
  }
  return items
}

export function registerRatingQueueRoutes(app: Hono<AppBindings>) {
  app.get('/api/rating-queue', loadUser, requireRole('RATER'), async (c) => {
    const user = c.get('user')!
    const includeReviewReady = hasRole(user, 'MODERATOR')
    const items = await withDb(c.env, (db) => listQueue(db, user.id, includeReviewReady))
    const activeClaims = items.filter((item) => item.myClaimStatus === 'ACTIVE').length
    return c.json({
      items,
      limits: {
        activeQueue: MAX_ACTIVE_QUEUE_ITEMS,
        activeClaimsPerRater: MAX_ACTIVE_CLAIMS_PER_RATER,
      },
      activeClaims,
    })
  })

  // Rating work has its own task detail endpoint. The public Level detail API is
  // intentionally not needed to render the rating form.
  app.get('/api/rating-queue/:id', loadUser, requireRole('RATER'), async (c) => {
    const user = c.get('user')!
    const includeReviewReady = hasRole(user, 'MODERATOR')
    const items = await withDb(c.env, (db) => listQueue(db, user.id, includeReviewReady))
    const item = items.find((row) => row.id === c.req.param('id')) ?? null
    if (!item) return c.json({ error: 'Rating task not found or no longer available' }, 404)
    return c.json({ item })
  })

  app.post('/api/rating-queue/:id/claim', loadUser, requireRole('RATER'), async (c) => {
    const user = c.get('user')!
    const result = await withDb(c.env, async (db) => inTransaction(db, async () => {
      const itemResult = await db.query(
        `SELECT q.*,lv.level_id
         FROM rating_queue_items q
         JOIN level_versions lv ON lv.id=q.level_version_id
         WHERE q.id=$1 FOR UPDATE`,
        [c.req.param('id')],
      )
      if (!itemResult.rowCount) return { kind: 'missing' as const }
      const item = itemResult.rows[0]
      if (item.status !== 'OPEN') return { kind: 'not_open' as const }

      const existingVote = await db.query(
        `SELECT id FROM rating_votes WHERE level_version_id=$1 AND user_id=$2`,
        [item.level_version_id, user.id],
      )
      if (existingVote.rowCount) return { kind: 'already_voted' as const }

      const mine = await db.query(
        `SELECT status FROM rating_queue_claims WHERE queue_item_id=$1 AND user_id=$2`,
        [item.id, user.id],
      )
      if (mine.rows[0]?.status === 'SUBMITTED') return { kind: 'already_voted' as const }
      if (mine.rows[0]?.status === 'ACTIVE') return { kind: 'ok' as const, claimStatus: 'ACTIVE' }

      const activeMine = await db.query(
        `SELECT count(*)::int AS count
         FROM rating_queue_claims qc
         JOIN rating_queue_items q ON q.id=qc.queue_item_id
         WHERE qc.user_id=$1 AND qc.status='ACTIVE' AND q.status='OPEN'`,
        [user.id],
      )
      if (Number(activeMine.rows[0]?.count ?? 0) >= MAX_ACTIVE_CLAIMS_PER_RATER) {
        return { kind: 'claim_limit' as const }
      }

      const capacity = await db.query(
        `SELECT
           (SELECT count(*)::int FROM rating_votes rv WHERE rv.level_version_id=$1) AS votes,
           (SELECT count(*)::int FROM rating_queue_claims qc WHERE qc.queue_item_id=$2 AND qc.status='ACTIVE') AS claims`,
        [item.level_version_id, item.id],
      )
      const votes = Number(capacity.rows[0]?.votes ?? 0)
      const claims = Number(capacity.rows[0]?.claims ?? 0)
      if (votes + claims >= Number(item.max_votes)) return { kind: 'full' as const }

      await db.query(
        `INSERT INTO rating_queue_claims(queue_item_id,user_id,status)
         VALUES ($1,$2,'ACTIVE')
         ON CONFLICT(queue_item_id,user_id) DO UPDATE
         SET status='ACTIVE',claimed_at=now(),completed_at=NULL,updated_at=now()`,
        [item.id, user.id],
      )
      await audit(db, user.id, 'RATING_QUEUE_CLAIM', 'rating_queue_item', item.id, { levelVersionId: item.level_version_id })
      return { kind: 'ok' as const, claimStatus: 'ACTIVE' }
    }))

    if (result.kind === 'missing') return c.json({ error: 'Queue item not found' }, 404)
    if (result.kind === 'not_open') return c.json({ error: 'This rating item is no longer open' }, 409)
    if (result.kind === 'already_voted') return c.json({ error: 'You already submitted a rating for this Version' }, 409)
    if (result.kind === 'claim_limit') return c.json({ error: `You can hold at most ${MAX_ACTIVE_CLAIMS_PER_RATER} active rating claims` }, 409)
    if (result.kind === 'full') return c.json({ error: 'Enough raters are already working on this item' }, 409)
    return c.json({ claim: { status: result.claimStatus } })
  })

  app.delete('/api/rating-queue/:id/claim', loadUser, requireRole('RATER'), async (c) => {
    const user = c.get('user')!
    const released = await withDb(c.env, async (db) => {
      const result = await db.query(
        `UPDATE rating_queue_claims
         SET status='RELEASED',completed_at=now(),updated_at=now()
         WHERE queue_item_id=$1 AND user_id=$2 AND status='ACTIVE'
         RETURNING id`,
        [c.req.param('id'), user.id],
      )
      if (result.rowCount) await audit(db, user.id, 'RATING_QUEUE_RELEASE', 'rating_queue_item', c.req.param('id'), {})
      return !!result.rowCount
    })
    if (!released) return c.json({ error: 'Active claim not found' }, 404)
    return c.json({ ok: true })
  })

  // New RATER UI writes through the queue task, not the Level display API.
  app.post('/api/rating-queue/:id/rating', loadUser, requireRole('RATER'), async (c) => {
    const user = c.get('user')!
    const body: RatingInput = await c.req.json<RatingInput>().catch((): RatingInput => ({}))
    const rating = parseRatingInput(body)
    if (!rating) return c.json({ error: 'Invalid rating. family, anchorTier, lean(-2..2), confidence(1..5) are required; comment max 4000 chars.' }, 400)

    const outcome = await withDb(c.env, async (db) => inTransaction(db, async () => {
      const itemResult = await db.query(
        `SELECT q.id,q.level_version_id,q.status
         FROM rating_queue_items q
         WHERE q.id=$1 FOR UPDATE`,
        [c.req.param('id')],
      )
      if (!itemResult.rowCount) return { kind: 'missing' as const }
      const item = itemResult.rows[0]
      if (item.status !== 'OPEN') return { kind: 'not_open' as const }

      const existingVote = await db.query(
        `SELECT id FROM rating_votes WHERE level_version_id=$1 AND user_id=$2`,
        [item.level_version_id, user.id],
      )
      if (existingVote.rowCount) return { kind: 'already_voted' as const }

      const claim = await db.query(
        `SELECT status FROM rating_queue_claims WHERE queue_item_id=$1 AND user_id=$2 FOR UPDATE`,
        [item.id, user.id],
      )
      if (claim.rows[0]?.status !== 'ACTIVE') return { kind: 'claim_required' as const }

      const voteResult = await db.query(
        `INSERT INTO rating_votes(level_version_id,user_id,family,anchor_tier,lean,confidence,comment)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING *`,
        [item.level_version_id, user.id, rating.family, rating.anchorTier, rating.lean, rating.confidence, rating.comment],
      )

      await db.query(
        `UPDATE rating_queue_claims
         SET status='SUBMITTED',completed_at=now(),updated_at=now()
         WHERE queue_item_id=$1 AND user_id=$2 AND status='ACTIVE'`,
        [item.id, user.id],
      )
      const assessment = await refreshQueueItem(db, item.id)
      await audit(db, user.id, 'RATING_VOTE', 'level_version', item.level_version_id, {
        family: rating.family,
        anchorTier: rating.anchorTier,
        lean: rating.lean,
        confidence: rating.confidence,
        queueItemId: item.id,
        queueStatus: assessment?.status ?? null,
        source: 'RATING_TASK',
      })
      return { kind: 'ok' as const, vote: voteResult.rows[0], assessment }
    }))

    if (outcome.kind === 'missing') return c.json({ error: 'Rating task not found' }, 404)
    if (outcome.kind === 'not_open') return c.json({ error: 'This rating task is no longer open' }, 409)
    if (outcome.kind === 'already_voted') return c.json({ error: 'You already submitted a rating for this Version' }, 409)
    if (outcome.kind === 'claim_required') return c.json({ error: 'Claim this rating task before submitting a rating' }, 409)
    return c.json({ vote: outcome.vote, queue: outcome.assessment })
  })

  // Compatibility endpoint for older clients. New UI code must not use this;
  // rating work is owned by /api/rating-queue/:id/rating.
  app.post('/api/levels/:id/votes', loadUser, requireRole('RATER'), async (c) => {
    const user = c.get('user')!
    const body: RatingInput = await c.req.json<RatingInput>().catch((): RatingInput => ({}))
    const rating = parseRatingInput(body)
    if (!rating) return c.json({ error: 'Invalid vote. family, anchorTier, lean(-2..2), confidence(1..5) are required.' }, 400)

    const outcome = await withDb(c.env, async (db) => inTransaction(db, async () => {
      const versionResult = await db.query(
        `SELECT current_version_id FROM levels WHERE id=$1 FOR UPDATE`,
        [c.req.param('id')],
      )
      const versionId = versionResult.rows[0]?.current_version_id as string | undefined
      if (!versionId) return { kind: 'missing' as const }

      const queueResult = await db.query(
        `SELECT * FROM rating_queue_items WHERE level_version_id=$1 FOR UPDATE`,
        [versionId],
      )
      const queueItem = queueResult.rows[0] ?? null
      const existingVote = await db.query(
        `SELECT id FROM rating_votes WHERE level_version_id=$1 AND user_id=$2`,
        [versionId, user.id],
      )

      if (queueItem && queueItem.status !== 'CLOSED' && !existingVote.rowCount) {
        if (queueItem.status !== 'OPEN') return { kind: 'review_ready' as const }
        const claim = await db.query(
          `SELECT status FROM rating_queue_claims WHERE queue_item_id=$1 AND user_id=$2`,
          [queueItem.id, user.id],
        )
        if (claim.rows[0]?.status !== 'ACTIVE') return { kind: 'claim_required' as const, queueItemId: queueItem.id }
      }

      const voteResult = await db.query(
        `INSERT INTO rating_votes(level_version_id,user_id,family,anchor_tier,lean,confidence,comment)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT(level_version_id,user_id)
         DO UPDATE SET family=EXCLUDED.family,anchor_tier=EXCLUDED.anchor_tier,lean=EXCLUDED.lean,
                       confidence=EXCLUDED.confidence,comment=EXCLUDED.comment,updated_at=now()
         RETURNING *`,
        [versionId, user.id, rating.family, rating.anchorTier, rating.lean, rating.confidence, rating.comment],
      )

      let assessment: ReviewAssessment | null = null
      if (queueItem && queueItem.status !== 'CLOSED') {
        await db.query(
          `UPDATE rating_queue_claims
           SET status='SUBMITTED',completed_at=now(),updated_at=now()
           WHERE queue_item_id=$1 AND user_id=$2 AND status='ACTIVE'`,
          [queueItem.id, user.id],
        )
        assessment = await refreshQueueItem(db, queueItem.id)
      }

      await audit(db, user.id, 'RATING_VOTE', 'level_version', versionId, {
        family: rating.family,
        anchorTier: rating.anchorTier,
        lean: rating.lean,
        confidence: rating.confidence,
        queueItemId: queueItem?.id ?? null,
        queueStatus: assessment?.status ?? null,
        source: 'LEVEL_COMPAT',
      })
      return { kind: 'ok' as const, vote: voteResult.rows[0], assessment }
    }))

    if (outcome.kind === 'missing') return c.json({ error: 'Level/current Version not found' }, 404)
    if (outcome.kind === 'claim_required') return c.json({ error: 'Claim this rating queue item before submitting a rating', queueItemId: outcome.queueItemId }, 409)
    if (outcome.kind === 'review_ready') return c.json({ error: 'This rating item is already ready for staff review' }, 409)
    return c.json({ vote: outcome.vote, queue: outcome.assessment })
  })

  app.get('/api/admin/rating-queue', loadUser, requireRole('MODERATOR'), async (c) => {
    const user = c.get('user')!
    const items = await withDb(c.env, (db) => listQueue(db, user.id, true))
    return c.json({ items, limits: { activeQueue: MAX_ACTIVE_QUEUE_ITEMS } })
  })

  app.post('/api/admin/rating-queue', loadUser, requireRole('MODERATOR'), async (c) => {
    const user = c.get('user')!
    const body = await c.req.json<any>().catch(() => ({}))
    const levelId = typeof body.levelId === 'string' ? body.levelId.trim() : ''
    const levelVersionId = typeof body.levelVersionId === 'string' ? body.levelVersionId.trim() : ''
    const minVotes = Number(body.minVotes ?? 2)
    const maxVotes = Number(body.maxVotes ?? 3)
    const priority = Number(body.priority ?? 0)
    if (!Number.isInteger(minVotes) || minVotes < 2 || minVotes > 5
        || !Number.isInteger(maxVotes) || maxVotes < 3 || maxVotes > 7 || maxVotes < minVotes
        || !Number.isInteger(priority) || priority < -100 || priority > 100) {
      return c.json({ error: 'minVotes must be 2..5, maxVotes 3..7 and >= minVotes, priority -100..100' }, 400)
    }
    if (!levelId && !levelVersionId) return c.json({ error: 'levelId or levelVersionId is required' }, 400)

    const result = await withDb(c.env, async (db) => inTransaction(db, async () => {
      const versionResult = levelVersionId
        ? await db.query(
            `SELECT lv.id,lv.level_id FROM level_versions lv WHERE lv.id=$1`,
            [levelVersionId],
          )
        : await db.query(
            `SELECT current_version_id AS id,id AS level_id FROM levels WHERE id=$1`,
            [levelId],
          )
      const version = versionResult.rows[0] ?? null
      if (!version?.id) return { kind: 'missing' as const }
      if (levelId && version.level_id !== levelId) return { kind: 'mismatch' as const }

      const existing = await db.query(`SELECT * FROM rating_queue_items WHERE level_version_id=$1`, [version.id])
      if (existing.rowCount) {
        if (existing.rows[0].status === 'CLOSED') return { kind: 'closed_exists' as const }
        return { kind: 'existing' as const, item: existing.rows[0] }
      }

      const active = await db.query(`SELECT count(*)::int AS count FROM rating_queue_items WHERE status<>'CLOSED'`)
      if (Number(active.rows[0]?.count ?? 0) >= MAX_ACTIVE_QUEUE_ITEMS) return { kind: 'queue_full' as const }

      const inserted = await db.query(
        `INSERT INTO rating_queue_items(level_version_id,min_votes,max_votes,priority,opened_by)
         VALUES ($1,$2,$3,$4,$5)
         RETURNING *`,
        [version.id, minVotes, maxVotes, priority, user.id],
      )
      await audit(db, user.id, 'RATING_QUEUE_OPEN', 'rating_queue_item', inserted.rows[0].id, {
        levelVersionId: version.id,
        minVotes,
        maxVotes,
        priority,
      })
      return { kind: 'created' as const, item: inserted.rows[0] }
    }))

    if (result.kind === 'missing') return c.json({ error: 'Level/current Version not found' }, 404)
    if (result.kind === 'mismatch') return c.json({ error: 'Version does not belong to the requested Level' }, 400)
    if (result.kind === 'closed_exists') return c.json({ error: 'This Version already has a closed rating round; use a new Version for another round' }, 409)
    if (result.kind === 'queue_full') return c.json({ error: `Rating queue is capped at ${MAX_ACTIVE_QUEUE_ITEMS} active items` }, 409)
    return c.json({ item: result.item }, result.kind === 'created' ? 201 : 200)
  })

  app.patch('/api/admin/rating-queue/:id', loadUser, requireRole('MODERATOR'), async (c) => {
    const user = c.get('user')!
    const body: { status?: string } = await c.req.json<{ status?: string }>().catch((): { status?: string } => ({}))
    if (body.status !== 'CLOSED') return c.json({ error: 'Only status=CLOSED is supported' }, 400)
    const closed = await withDb(c.env, async (db) => inTransaction(db, async () => {
      const item = await db.query(`SELECT * FROM rating_queue_items WHERE id=$1 FOR UPDATE`, [c.req.param('id')])
      if (!item.rowCount) return false
      await db.query(
        `UPDATE rating_queue_claims
         SET status='RELEASED',completed_at=COALESCE(completed_at,now()),updated_at=now()
         WHERE queue_item_id=$1 AND status='ACTIVE'`,
        [c.req.param('id')],
      )
      await db.query(
        `UPDATE rating_queue_items
         SET status='CLOSED',closed_at=now(),updated_at=now()
         WHERE id=$1`,
        [c.req.param('id')],
      )
      await audit(db, user.id, 'RATING_QUEUE_CLOSE', 'rating_queue_item', c.req.param('id'), { manual: true })
      return true
    }))
    if (!closed) return c.json({ error: 'Queue item not found' }, 404)
    return c.json({ ok: true })
  })
}
