import type { Hono } from 'hono'
import type { AppBindings } from './auth'
import { requireRole } from './auth'
import { withDb } from './db'
import { inspectProposalRows } from './proposals/inspect'
import { audit, normalizeFamily, normalizeTier } from './services'

const REFERENCE_STATUSES = new Set(['ACTIVE', 'NEEDS_REVIEW', 'RETIRED'])
const PROPOSAL_STATUSES = new Set(['OPEN', 'APPROVED', 'REJECTED', 'WITHDRAWN'])
const PROPOSAL_TYPES = new Set(['RERATE', 'REFERENCE_ADD', 'REFERENCE_MOVE', 'REFERENCE_REMOVE', 'METADATA', 'OTHER'])
const PROPOSAL_VOTES = new Set(['AGREE', 'DISAGREE', 'ABSTAIN'])

function integerQuery(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(Math.trunc(parsed), min), max)
}

function proposalFromRow(row: any, inspection: { state: string; message: string }) {
  return {
    id: row.id,
    type: row.type,
    levelId: row.level_id,
    levelTitle: row.level_title,
    title: row.title,
    payload: row.payload ?? {},
    reason: row.reason,
    status: row.status,
    proposerId: row.proposer_id,
    proposerName: row.proposer_name,
    createdAt: row.created_at,
    decidedAt: row.decided_at ?? null,
    decidedByName: row.decided_by_name ?? null,
    agree: Number(row.agree ?? 0),
    disagree: Number(row.disagree ?? 0),
    abstain: Number(row.abstain ?? 0),
    myVote: row.my_vote ?? null,
    decisionReason: row.decision_reason ?? null,
    executionState: inspection.state,
    executionMessage: inspection.message,
  }
}

const proposalSelect = `
  SELECT p.*,l.title AS level_title,proposer.display_name AS proposer_name,
         decider.display_name AS decided_by_name,
         coalesce(v.agree,0)::int AS agree,
         coalesce(v.disagree,0)::int AS disagree,
         coalesce(v.abstain,0)::int AS abstain,
         mine.vote AS my_vote
  FROM proposals p
  JOIN levels l ON l.id=p.level_id
  JOIN users proposer ON proposer.id=p.proposer_id
  LEFT JOIN users decider ON decider.id=p.decided_by
  LEFT JOIN LATERAL (
    SELECT count(*) FILTER (WHERE vote='AGREE')::int AS agree,
           count(*) FILTER (WHERE vote='DISAGREE')::int AS disagree,
           count(*) FILTER (WHERE vote='ABSTAIN')::int AS abstain
    FROM proposal_votes pv WHERE pv.proposal_id=p.id
  ) v ON true
  LEFT JOIN proposal_votes mine ON mine.proposal_id=p.id AND mine.user_id=$1::uuid
`

export function registerPublicRoutes(app: Hono<AppBindings>) {
  app.get('/api/catalog/levels', async (c) => {
    const search = (c.req.query('search') ?? '').trim()
    const family = normalizeFamily(c.req.query('family'))
    const tier = c.req.query('tier') ? normalizeTier(c.req.query('tier')) : null
    if (c.req.query('tier') && tier === null) return c.json({ error: 'tier must be an integer from 1 to 30' }, 400)
    const technique = (c.req.query('technique') ?? '').trim()
    const referenceStatusRaw = (c.req.query('referenceStatus') ?? '').trim()
    const referenceStatus = referenceStatusRaw || null
    if (referenceStatus && !REFERENCE_STATUSES.has(referenceStatus)) return c.json({ error: 'Invalid referenceStatus' }, 400)
    const rated = (c.req.query('rated') ?? 'all').trim().toLowerCase()
    if (!['all', 'rated', 'unrated'].includes(rated)) return c.json({ error: 'rated must be all, rated, or unrated' }, 400)
    const sort = (c.req.query('sort') ?? 'rating').trim().toLowerCase()
    if (!['rating', 'title', 'votes', 'recent'].includes(sort)) return c.json({ error: 'Invalid sort' }, 400)
    const limit = integerQuery(c.req.query('limit'), 50, 1, 100)
    const offset = integerQuery(c.req.query('offset'), 0, 0, 1_000_000)
    const orderBy = sort === 'title'
      ? 'l.title,l.creator'
      : sort === 'votes'
        ? 'vote_count DESC,l.title'
        : sort === 'recent'
          ? 'l.updated_at DESC,l.title'
          : `CASE cr.family WHEN 'P' THEN 1 WHEN 'G' THEN 2 WHEN 'U' THEN 3 ELSE 4 END,cr.tier NULLS LAST,l.title`

    const result = await withDb(c.env, async (db) => {
      const where = `l.status<>'ARCHIVED'
        AND ($1='' OR l.title ILIKE '%'||$1||'%' OR l.song ILIKE '%'||$1||'%' OR l.creator ILIKE '%'||$1||'%')
        AND ($2::text IS NULL OR cr.family=$2)
        AND ($3::int IS NULL OR cr.tier=$3)
        AND ($4='' OR EXISTS (
          SELECT 1 FROM difficulty_references r JOIN level_versions rv ON rv.id=r.level_version_id
          WHERE rv.level_id=l.id AND r.technique ILIKE '%'||$4||'%'
        ))
        AND ($5::text IS NULL OR EXISTS (
          SELECT 1 FROM difficulty_references r JOIN level_versions rv ON rv.id=r.level_version_id
          WHERE rv.level_id=l.id AND r.status=$5
        ))
        AND ($6='all' OR ($6='rated' AND cr.id IS NOT NULL) OR ($6='unrated' AND cr.id IS NULL))`
      const params = [search, family, tier, technique, referenceStatus, rated]
      const [count, rows] = await Promise.all([
        db.query(
          `SELECT count(*)::int AS count
           FROM levels l
           LEFT JOIN canonical_ratings cr ON cr.level_version_id=l.current_version_id AND cr.effective_to IS NULL
           WHERE ${where}`,
          params,
        ),
        db.query(
          `SELECT l.id,l.song,l.title,l.creator,l.status,l.current_version_id,l.updated_at,
                  cr.family,cr.tier,cr.confidence,
                  (SELECT count(*)::int FROM rating_votes rv WHERE rv.level_version_id=l.current_version_id) AS vote_count,
                  (SELECT count(*)::int FROM difficulty_references r JOIN level_versions rv ON rv.id=r.level_version_id
                   WHERE rv.level_id=l.id AND r.status<>'RETIRED') AS reference_count
           FROM levels l
           LEFT JOIN canonical_ratings cr ON cr.level_version_id=l.current_version_id AND cr.effective_to IS NULL
           WHERE ${where}
           ORDER BY ${orderBy}
           LIMIT $7 OFFSET $8`,
          [...params, limit, offset],
        ),
      ])
      return {
        total: Number(count.rows[0]?.count ?? 0),
        levels: rows.rows.map((row) => ({
          id: row.id,
          song: row.song,
          title: row.title,
          creator: row.creator,
          status: row.status,
          currentVersionId: row.current_version_id,
          currentRating: row.family ? { family: row.family, tier: Number(row.tier), confidence: row.confidence === null ? null : Number(row.confidence) } : null,
          voteCount: Number(row.vote_count ?? 0),
          referenceCount: Number(row.reference_count ?? 0),
        })),
      }
    })
    return c.json({ ...result, limit, offset })
  })

  app.get('/api/catalog/levels/:id', async (c) => {
    const id = c.req.param('id')
    const detail = await withDb(c.env, async (db) => {
      const levelResult = await db.query(
        `SELECT l.*,cr.family,cr.tier,cr.confidence,
                (SELECT count(*)::int FROM rating_votes rv WHERE rv.level_version_id=l.current_version_id) AS vote_count
         FROM levels l
         LEFT JOIN canonical_ratings cr ON cr.level_version_id=l.current_version_id AND cr.effective_to IS NULL
         WHERE l.id=$1 AND l.status<>'ARCHIVED'`,
        [id],
      )
      if (!levelResult.rowCount) return null
      const level = levelResult.rows[0]
      const [versions, ratings, voteSummary, ratingVotes, references] = await Promise.all([
        db.query(
          `SELECT lv.id,lv.label,lv.sha256,lv.download_url,lv.notes,lv.created_at,
                  cr.family,cr.tier,cr.confidence
           FROM level_versions lv
           LEFT JOIN canonical_ratings cr ON cr.level_version_id=lv.id AND cr.effective_to IS NULL
           WHERE lv.level_id=$1 ORDER BY lv.created_at DESC`,
          [id],
        ),
        db.query(
          `SELECT cr.id,cr.level_version_id,lv.label AS version_label,cr.family,cr.tier,cr.confidence,
                  cr.reason,cr.effective_from,cr.effective_to
           FROM canonical_ratings cr JOIN level_versions lv ON lv.id=cr.level_version_id
           WHERE lv.level_id=$1 ORDER BY cr.effective_from DESC`,
          [id],
        ),
        db.query(
          `SELECT rv.family,rv.anchor_tier,count(*)::int AS count,
                  percentile_cont(0.5) WITHIN GROUP (ORDER BY rv.anchor_tier+rv.lean*0.2) AS median_evidence,
                  avg(rv.anchor_tier+rv.lean*0.2) AS mean_evidence
           FROM rating_votes rv JOIN level_versions lv ON lv.id=rv.level_version_id
           WHERE lv.level_id=$1
           GROUP BY rv.family,rv.anchor_tier ORDER BY rv.family,rv.anchor_tier`,
          [id],
        ),
        db.query(
          `SELECT rv.user_id,u.display_name,rv.level_version_id,lv.label AS version_label,
                  rv.family,rv.anchor_tier,rv.lean,rv.confidence,rv.comment,rv.updated_at
           FROM rating_votes rv
           JOIN level_versions lv ON lv.id=rv.level_version_id
           JOIN users u ON u.id=rv.user_id
           WHERE lv.level_id=$1
           ORDER BY rv.updated_at DESC`,
          [id],
        ),
        db.query(
          `SELECT r.id,r.level_version_id,lv.label AS version_label,r.family,r.tier,r.technique,
                  r.position_hint,r.status,r.confidence,r.notes
           FROM difficulty_references r JOIN level_versions lv ON lv.id=r.level_version_id
           WHERE lv.level_id=$1 ORDER BY r.status,r.family,r.tier,r.technique`,
          [id],
        ),
      ])
      return {
        id: level.id,
        song: level.song,
        title: level.title,
        creator: level.creator,
        status: level.status,
        currentVersionId: level.current_version_id,
        currentRating: level.family ? { family: level.family, tier: Number(level.tier), confidence: level.confidence === null ? null : Number(level.confidence) } : null,
        voteCount: Number(level.vote_count ?? 0),
        referenceCount: references.rows.filter((row) => row.status !== 'RETIRED').length,
        versions: versions.rows.map((row) => ({
          id: row.id,
          label: row.label,
          sha256: row.sha256,
          downloadUrl: row.download_url,
          notes: row.notes,
          createdAt: row.created_at,
          currentRating: row.family ? { family: row.family, tier: Number(row.tier), confidence: row.confidence === null ? null : Number(row.confidence) } : null,
        })),
        ratingHistory: ratings.rows.map((row) => ({
          id: row.id,
          levelVersionId: row.level_version_id,
          versionLabel: row.version_label,
          family: row.family,
          tier: Number(row.tier),
          confidence: row.confidence === null ? null : Number(row.confidence),
          reason: row.reason,
          effectiveFrom: row.effective_from,
          effectiveTo: row.effective_to,
        })),
        voteSummary: voteSummary.rows.map((row) => ({
          family: row.family,
          anchorTier: Number(row.anchor_tier),
          count: Number(row.count),
          medianEvidence: Number(row.median_evidence),
          meanEvidence: Number(row.mean_evidence),
        })),
        ratingVotes: ratingVotes.rows.map((row) => ({
          userId: row.user_id,
          displayName: row.display_name,
          levelVersionId: row.level_version_id,
          versionLabel: row.version_label,
          family: row.family,
          anchorTier: Number(row.anchor_tier),
          lean: Number(row.lean),
          confidence: Number(row.confidence),
          comment: row.comment,
          updatedAt: row.updated_at,
        })),
        references: references.rows.map((row) => ({
          id: row.id,
          levelVersionId: row.level_version_id,
          versionLabel: row.version_label,
          family: row.family,
          tier: Number(row.tier),
          technique: row.technique,
          positionHint: row.position_hint === null ? null : Number(row.position_hint),
          status: row.status,
          confidence: row.confidence === null ? null : Number(row.confidence),
          notes: row.notes,
        })),
      }
    })
    if (!detail) return c.json({ error: 'Level not found' }, 404)
    return c.json(detail)
  })

  app.get('/api/catalog/references', async (c) => {
    const search = (c.req.query('search') ?? '').trim()
    const family = normalizeFamily(c.req.query('family'))
    const tier = c.req.query('tier') ? normalizeTier(c.req.query('tier')) : null
    if (c.req.query('tier') && tier === null) return c.json({ error: 'tier must be an integer from 1 to 30' }, 400)
    const technique = (c.req.query('technique') ?? '').trim()
    const statusRaw = (c.req.query('status') ?? '').trim()
    const status = statusRaw || null
    if (status && !REFERENCE_STATUSES.has(status)) return c.json({ error: 'Invalid Reference status' }, 400)
    const levelId = (c.req.query('levelId') ?? '').trim()
    const limit = integerQuery(c.req.query('limit'), 50, 1, 100)
    const offset = integerQuery(c.req.query('offset'), 0, 0, 1_000_000)
    const params = [search, family, tier, technique, status, levelId]
    const where = `l.status<>'ARCHIVED'
      AND ($1='' OR l.title ILIKE '%'||$1||'%' OR l.song ILIKE '%'||$1||'%' OR l.creator ILIKE '%'||$1||'%' OR r.technique ILIKE '%'||$1||'%')
      AND ($2::text IS NULL OR r.family=$2)
      AND ($3::int IS NULL OR r.tier=$3)
      AND ($4='' OR r.technique ILIKE '%'||$4||'%')
      AND ($5::text IS NULL OR r.status=$5)
      AND ($6='' OR l.id::text=$6)`
    const result = await withDb(c.env, async (db) => {
      const [count, rows] = await Promise.all([
        db.query(
          `SELECT count(*)::int AS count FROM difficulty_references r
           JOIN level_versions lv ON lv.id=r.level_version_id
           JOIN levels l ON l.id=lv.level_id WHERE ${where}`,
          params,
        ),
        db.query(
          `SELECT r.id,r.level_version_id,r.family,r.tier,r.technique,r.position_hint,r.status,r.confidence,r.notes,
                  lv.level_id,lv.label AS version_label,l.title AS level_title,l.song,l.creator
           FROM difficulty_references r
           JOIN level_versions lv ON lv.id=r.level_version_id
           JOIN levels l ON l.id=lv.level_id
           WHERE ${where}
           ORDER BY CASE r.family WHEN 'P' THEN 1 WHEN 'G' THEN 2 WHEN 'U' THEN 3 END,r.tier,r.technique,l.title
           LIMIT $7 OFFSET $8`,
          [...params, limit, offset],
        ),
      ])
      return {
        total: Number(count.rows[0]?.count ?? 0),
        references: rows.rows.map((row) => ({
          id: row.id,
          levelId: row.level_id,
          levelVersionId: row.level_version_id,
          levelTitle: row.level_title,
          song: row.song,
          creator: row.creator,
          versionLabel: row.version_label,
          family: row.family,
          tier: Number(row.tier),
          technique: row.technique,
          positionHint: row.position_hint === null ? null : Number(row.position_hint),
          status: row.status,
          confidence: row.confidence === null ? null : Number(row.confidence),
          notes: row.notes,
        })),
      }
    })
    return c.json({ ...result, limit, offset })
  })

  app.get('/api/governance/proposals', async (c) => {
    const userId = c.get('user')?.id ?? null
    const statusRaw = (c.req.query('status') ?? '').trim()
    const status = statusRaw || null
    if (status && !PROPOSAL_STATUSES.has(status)) return c.json({ error: 'Invalid proposal status' }, 400)
    const typeRaw = (c.req.query('type') ?? '').trim()
    const type = typeRaw || null
    if (type && !PROPOSAL_TYPES.has(type)) return c.json({ error: 'Invalid proposal type' }, 400)
    const levelId = (c.req.query('levelId') ?? '').trim()
    const search = (c.req.query('search') ?? '').trim()
    const limit = integerQuery(c.req.query('limit'), 25, 1, 100)
    const offset = integerQuery(c.req.query('offset'), 0, 0, 1_000_000)

    const result = await withDb(c.env, async (db) => {
      const filterParams = [status, type, levelId, search]
      const where = `($2::text IS NULL OR p.status=$2)
        AND ($3::text IS NULL OR p.type=$3)
        AND ($4='' OR p.level_id::text=$4)
        AND ($5='' OR p.title ILIKE '%'||$5||'%' OR p.reason ILIKE '%'||$5||'%' OR l.title ILIKE '%'||$5||'%')`
      const [count, rows] = await Promise.all([
        db.query(
          `SELECT count(*)::int AS count FROM proposals p JOIN levels l ON l.id=p.level_id WHERE ${where}`,
          [userId, ...filterParams],
        ),
        db.query(
          `${proposalSelect}
           WHERE ${where}
           ORDER BY CASE p.status WHEN 'OPEN' THEN 0 ELSE 1 END,p.created_at DESC
           LIMIT $6 OFFSET $7`,
          [userId, ...filterParams, limit, offset],
        ),
      ])
      const inspections = await inspectProposalRows(db, rows.rows)
      return {
        total: Number(count.rows[0]?.count ?? 0),
        proposals: rows.rows.map((row) => proposalFromRow(row, inspections.get(row.id) ?? { state: 'INCOMPLETE', message: 'Unable to inspect proposal.' })),
      }
    })
    return c.json({ ...result, limit, offset })
  })

  app.get('/api/governance/proposals/:id', async (c) => {
    const userId = c.get('user')?.id ?? null
    const id = c.req.param('id')
    const result = await withDb(c.env, async (db) => {
      const proposalResult = await db.query(`${proposalSelect} WHERE p.id=$2`, [userId, id])
      if (!proposalResult.rowCount) return null
      const row = proposalResult.rows[0]
      const inspections = await inspectProposalRows(db, [row])
      const [votes, comments] = await Promise.all([
        db.query(
          `SELECT pv.user_id,u.display_name,pv.vote,pv.updated_at
           FROM proposal_votes pv JOIN users u ON u.id=pv.user_id
           WHERE pv.proposal_id=$1
           ORDER BY CASE pv.vote WHEN 'AGREE' THEN 1 WHEN 'DISAGREE' THEN 2 ELSE 3 END,u.display_name`,
          [id],
        ),
        db.query(
          `SELECT pc.id,pc.user_id,u.display_name,pc.body,pc.created_at,pc.updated_at
           FROM proposal_comments pc JOIN users u ON u.id=pc.user_id
           WHERE pc.proposal_id=$1 ORDER BY pc.created_at`,
          [id],
        ),
      ])
      return {
        proposal: proposalFromRow(row, inspections.get(row.id) ?? { state: 'INCOMPLETE', message: 'Unable to inspect proposal.' }),
        votes: votes.rows.map((vote) => ({ userId: vote.user_id, displayName: vote.display_name, vote: vote.vote, updatedAt: vote.updated_at })),
        comments: comments.rows.map((comment) => ({
          id: comment.id,
          userId: comment.user_id,
          displayName: comment.display_name,
          body: comment.body,
          createdAt: comment.created_at,
          updatedAt: comment.updated_at,
        })),
      }
    })
    if (!result) return c.json({ error: 'Proposal not found' }, 404)
    return c.json(result)
  })

  app.post('/api/governance/proposals/:id/vote', requireRole('VIEWER'), async (c) => {
    const user = c.get('user')!
    const body = await c.req.json<{ vote?: string }>().catch(() => ({}))
    if (!body.vote || !PROPOSAL_VOTES.has(body.vote)) return c.json({ error: 'Invalid vote' }, 400)
    const result = await withDb(c.env, async (db) => {
      const proposal = await db.query('SELECT status FROM proposals WHERE id=$1', [c.req.param('id')])
      if (!proposal.rowCount) return { kind: 'missing' as const }
      if (proposal.rows[0].status !== 'OPEN') return { kind: 'closed' as const }
      const vote = await db.query(
        `INSERT INTO proposal_votes(proposal_id,user_id,vote)
         VALUES ($1,$2,$3)
         ON CONFLICT(proposal_id,user_id) DO UPDATE SET vote=EXCLUDED.vote,updated_at=now()
         RETURNING vote,updated_at`,
        [c.req.param('id'), user.id, body.vote],
      )
      return { kind: 'ok' as const, vote: vote.rows[0] }
    })
    if (result.kind === 'missing') return c.json({ error: 'Proposal not found' }, 404)
    if (result.kind === 'closed') return c.json({ error: 'Voting is closed for this proposal' }, 409)
    return c.json({ vote: result.vote })
  })

  app.post('/api/governance/proposals/:id/comments', requireRole('VIEWER'), async (c) => {
    const user = c.get('user')!
    const body = await c.req.json<{ body?: string }>().catch(() => ({}))
    const text = body.body?.trim() ?? ''
    if (!text || text.length > 4000) return c.json({ error: 'Comment must be 1 to 4000 characters' }, 400)
    const comment = await withDb(c.env, async (db) => {
      const proposal = await db.query('SELECT id FROM proposals WHERE id=$1', [c.req.param('id')])
      if (!proposal.rowCount) return null
      const inserted = await db.query(
        `INSERT INTO proposal_comments(proposal_id,user_id,body)
         VALUES ($1,$2,$3)
         RETURNING id,user_id,body,created_at,updated_at`,
        [c.req.param('id'), user.id, text],
      )
      await audit(db, user.id, 'PROPOSAL_COMMENT', 'proposal', c.req.param('id'), { commentId: inserted.rows[0].id })
      return {
        id: inserted.rows[0].id,
        userId: inserted.rows[0].user_id,
        displayName: user.displayName,
        body: inserted.rows[0].body,
        createdAt: inserted.rows[0].created_at,
        updatedAt: inserted.rows[0].updated_at,
      }
    })
    if (!comment) return c.json({ error: 'Proposal not found' }, 404)
    return c.json({ comment }, 201)
  })
}
