import type { Hono } from 'hono'
import type { AppBindings } from './auth'
import { loadUser, requireRole } from './auth'
import { inTransaction, withDb } from './db'
import { audit, normalizeFamily, normalizeTier } from './services'
import { createLevelFromTufObservation, TufReconciliationError } from './reconciliation/tuf'

const REFERENCE_STATUSES = new Set(['ACTIVE', 'NEEDS_REVIEW', 'RETIRED'])

function integerQuery(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(Math.trunc(parsed), min), max)
}

function clean(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function validSha(value: string | null): boolean {
  return value === null || /^[a-fA-F0-9]{64}$/.test(value)
}

/**
 * Compatibility replacement for the original v0.3 Level CRUD routes.
 * These routes are registered before the core app, so old clients still work
 * while the staff UI can use the practical metadata model:
 * song / artist / creator-or-team / effecter + per-version URLs/SHA.
 */
export function registerLevelMetadataRoutes(app: Hono<AppBindings>) {
  app.use('/api/admin/levels', loadUser)
  app.use('/api/admin/levels/*', loadUser)
  app.use('/api/admin/imports/tuf/create-level', loadUser)

  app.get('/api/levels', async (c) => {
    const search = (c.req.query('search') ?? '').trim()
    const family = normalizeFamily(c.req.query('family'))
    const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 50), 1), 100)
    const offset = Math.max(Number(c.req.query('offset') ?? 0), 0)
    const levels = await withDb(c.env, async (db) => {
      const result = await db.query(
        `SELECT l.id,l.song,l.title,l.artist,l.creator,l.effecter,l.status,l.current_version_id,
                cr.family,cr.tier,cr.confidence,
                (SELECT count(*)::int FROM rating_votes rv WHERE rv.level_version_id=l.current_version_id) AS vote_count,
                (SELECT count(*)::int FROM difficulty_references r JOIN level_versions rv ON rv.id=r.level_version_id
                 WHERE rv.level_id=l.id AND r.status<>'RETIRED') AS reference_count
         FROM levels l
         LEFT JOIN canonical_ratings cr ON cr.level_version_id=l.current_version_id AND cr.effective_to IS NULL
         WHERE l.status<>'ARCHIVED'
           AND ($1='' OR l.song ILIKE '%'||$1||'%' OR l.artist ILIKE '%'||$1||'%'
             OR l.creator ILIKE '%'||$1||'%' OR coalesce(l.effecter,'') ILIKE '%'||$1||'%'
             OR l.title ILIKE '%'||$1||'%')
           AND ($2::text IS NULL OR cr.family=$2)
         ORDER BY cr.family NULLS LAST,cr.tier NULLS LAST,l.song,l.artist
         LIMIT $3 OFFSET $4`,
        [search, family, limit, offset],
      )
      return result.rows.map((row) => ({
        id: row.id,
        song: row.song,
        title: row.title,
        artist: row.artist,
        creator: row.creator,
        effecter: row.effecter,
        status: row.status,
        currentVersionId: row.current_version_id,
        currentRating: row.family ? { family: row.family, tier: Number(row.tier), confidence: row.confidence === null ? null : Number(row.confidence) } : null,
        voteCount: Number(row.vote_count ?? 0),
        referenceCount: Number(row.reference_count ?? 0),
      }))
    })
    return c.json({ levels })
  })

  app.get('/api/levels/:id', async (c) => {
    const id = c.req.param('id')
    const detail = await withDb(c.env, async (db) => {
      const levelResult = await db.query(
        `SELECT l.*,cr.family,cr.tier,cr.confidence,
                (SELECT count(*)::int FROM rating_votes rv WHERE rv.level_version_id=l.current_version_id) AS vote_count
         FROM levels l
         LEFT JOIN canonical_ratings cr ON cr.level_version_id=l.current_version_id AND cr.effective_to IS NULL
         WHERE l.id=$1`,
        [id],
      )
      if (!levelResult.rowCount) return null
      const level = levelResult.rows[0]
      const [versions, ratings, voteSummary, ratingVotes, references] = await Promise.all([
        db.query(
          `SELECT lv.id,lv.label,lv.sha256,lv.download_url,lv.video_url,lv.notes,lv.created_at,
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
           FROM rating_votes rv JOIN level_versions lv ON lv.id=rv.level_version_id
           JOIN users u ON u.id=rv.user_id WHERE lv.level_id=$1 ORDER BY rv.updated_at DESC`,
          [id],
        ),
        db.query(
          `SELECT r.id,r.level_version_id,lv.label AS version_label,r.family,r.tier,r.technique,
                  r.position_hint,r.status,r.confidence,r.notes
           FROM difficulty_references r JOIN level_versions lv ON lv.id=r.level_version_id
           WHERE lv.level_id=$1 ORDER BY r.family,r.tier,r.technique`,
          [id],
        ),
      ])
      return {
        id: level.id,
        song: level.song,
        title: level.title,
        artist: level.artist,
        creator: level.creator,
        effecter: level.effecter,
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
          videoUrl: row.video_url,
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

  app.post('/api/admin/levels', requireRole('MODERATOR'), async (c) => {
    const user = c.get('user')!
    const body = await c.req.json<any>().catch(() => ({}))
    const song = clean(body.song)
    const artist = clean(body.artist) ?? 'Unknown'
    const creator = clean(body.creator)
    const effecter = clean(body.effecter)
    const versionLabel = clean(body.version?.label)
    const sha256 = clean(body.version?.sha256)
    const downloadUrl = clean(body.version?.downloadUrl)
    const videoUrl = clean(body.version?.videoUrl)
    const notes = clean(body.version?.notes)
    if (!song || !creator || !versionLabel) return c.json({ error: 'song, artist, creator and version.label are required' }, 400)
    if (!validSha(sha256)) return c.json({ error: 'sha256 must be 64 hex chars' }, 400)

    const created = await withDb(c.env, async (db) => inTransaction(db, async () => {
      const legacyTitle = clean(body.title) ?? song
      const status = clean(body.status) ?? 'LISTED'
      if (!['LISTED','UNLISTED','ARCHIVED'].includes(status)) throw new Error('Invalid level status')
      const level = await db.query(
        `INSERT INTO levels(song,title,artist,creator,effecter,status)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [song, legacyTitle, artist, creator, effecter, status],
      )
      const version = await db.query(
        `INSERT INTO level_versions(level_id,label,sha256,download_url,video_url,notes)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [level.rows[0].id, versionLabel, sha256?.toLowerCase() ?? null, downloadUrl, videoUrl, notes],
      )
      await db.query('UPDATE levels SET current_version_id=$2,updated_at=now() WHERE id=$1', [level.rows[0].id, version.rows[0].id])
      await audit(db, user.id, 'LEVEL_CREATE', 'level', level.rows[0].id, { versionId: version.rows[0].id, metadataModel: 'song-artist-creator-effecter' })
      return { level: level.rows[0], version: version.rows[0] }
    }))
    return c.json(created, 201)
  })

  app.patch('/api/admin/levels/:id', requireRole('MODERATOR'), async (c) => {
    const user = c.get('user')!
    const body = await c.req.json<any>().catch(() => ({}))
    const song = body.song === undefined ? null : clean(body.song)
    const artist = body.artist === undefined ? null : clean(body.artist)
    const creator = body.creator === undefined ? null : clean(body.creator)
    const effecterProvided = Object.prototype.hasOwnProperty.call(body, 'effecter')
    const effecter = effecterProvided ? clean(body.effecter) : null
    if (body.song !== undefined && !song) return c.json({ error: 'song cannot be empty' }, 400)
    if (body.artist !== undefined && !artist) return c.json({ error: 'artist cannot be empty' }, 400)
    if (body.creator !== undefined && !creator) return c.json({ error: 'creator cannot be empty' }, 400)
    const updated = await withDb(c.env, async (db) => {
      const result = await db.query(
        `UPDATE levels SET
           song=COALESCE($2,song),
           title=CASE WHEN $2::text IS NULL THEN title ELSE $2 END,
           artist=COALESCE($3,artist),
           creator=COALESCE($4,creator),
           effecter=CASE WHEN $5::boolean THEN $6 ELSE effecter END,
           status=COALESCE($7,status),updated_at=now()
         WHERE id=$1 RETURNING *`,
        [c.req.param('id'), song, artist, creator, effecterProvided, effecter, clean(body.status)],
      )
      if (result.rowCount) await audit(db, user.id, 'LEVEL_UPDATE', 'level', c.req.param('id'), { song, artist, creator, effecter: effecterProvided ? effecter : undefined, status: body.status })
      return result.rows[0] ?? null
    })
    if (!updated) return c.json({ error: 'Level not found' }, 404)
    return c.json({ level: updated })
  })

  app.post('/api/admin/levels/:id/versions', requireRole('MODERATOR'), async (c) => {
    const user = c.get('user')!
    const body = await c.req.json<any>().catch(() => ({}))
    const label = clean(body.label)
    const sha256 = clean(body.sha256)
    if (!label) return c.json({ error: 'label is required' }, 400)
    if (!validSha(sha256)) return c.json({ error: 'sha256 must be 64 hex chars' }, 400)
    const version = await withDb(c.env, async (db) => inTransaction(db, async () => {
      const inserted = await db.query(
        `INSERT INTO level_versions(level_id,label,sha256,download_url,video_url,notes)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [c.req.param('id'), label, sha256?.toLowerCase() ?? null, clean(body.downloadUrl), clean(body.videoUrl), clean(body.notes)],
      )
      if (body.makeCurrent !== false) await db.query('UPDATE levels SET current_version_id=$2,updated_at=now() WHERE id=$1', [c.req.param('id'), inserted.rows[0].id])
      await audit(db, user.id, 'LEVEL_VERSION_CREATE', 'level_version', inserted.rows[0].id, { levelId: c.req.param('id') })
      return inserted.rows[0]
    }))
    return c.json({ version }, 201)
  })

  app.post('/api/admin/imports/tuf/create-level', requireRole('MODERATOR'), async (c) => {
    const user = c.get('user')!
    const body = await c.req.json<any>().catch(() => ({}))
    const observationId = clean(body.observationId) ?? ''
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(observationId)) {
      return c.json({ error: 'observationId must be a UUID' }, 400)
    }
    try {
      const result = await withDb(c.env, (db) => createLevelFromTufObservation(db, {
        observationId,
        song: body.song,
        artist: body.artist,
        creator: body.creator,
        effecter: body.effecter,
        status: body.status,
        versionLabel: body.version?.label,
        sha256: body.version?.sha256,
        downloadUrl: body.version?.downloadUrl,
        videoUrl: body.version?.videoUrl,
        notes: body.version?.notes,
        actorId: user.id,
      }))
      return c.json(result, 201)
    } catch (error) {
      if (error instanceof TufReconciliationError) return c.json({ error: error.message }, error.status)
      throw error
    }
  })
}

/** Public catalog overrides registered before the original public catalog. */
export function registerLevelMetadataCatalogRoutes(app: Hono<AppBindings>) {
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
    if (!['all','rated','unrated'].includes(rated)) return c.json({ error: 'rated must be all, rated, or unrated' }, 400)
    const sort = (c.req.query('sort') ?? 'rating').trim().toLowerCase()
    if (!['rating','title','votes','recent'].includes(sort)) return c.json({ error: 'Invalid sort' }, 400)
    const limit = integerQuery(c.req.query('limit'), 50, 1, 100)
    const offset = integerQuery(c.req.query('offset'), 0, 0, 1_000_000)
    const orderBy = sort === 'title' ? 'l.song,l.artist,l.creator'
      : sort === 'votes' ? 'vote_count DESC,l.song'
      : sort === 'recent' ? 'l.updated_at DESC,l.song'
      : `CASE cr.family WHEN 'P' THEN 1 WHEN 'G' THEN 2 WHEN 'U' THEN 3 ELSE 4 END,cr.tier NULLS LAST,l.song`

    const result = await withDb(c.env, async (db) => {
      const where = `l.status<>'ARCHIVED'
        AND ($1='' OR l.song ILIKE '%'||$1||'%' OR l.artist ILIKE '%'||$1||'%'
          OR l.creator ILIKE '%'||$1||'%' OR coalesce(l.effecter,'') ILIKE '%'||$1||'%' OR l.title ILIKE '%'||$1||'%')
        AND ($2::text IS NULL OR cr.family=$2)
        AND ($3::int IS NULL OR cr.tier=$3)
        AND ($4='' OR EXISTS (SELECT 1 FROM difficulty_references r JOIN level_versions rv ON rv.id=r.level_version_id WHERE rv.level_id=l.id AND r.technique ILIKE '%'||$4||'%'))
        AND ($5::text IS NULL OR EXISTS (SELECT 1 FROM difficulty_references r JOIN level_versions rv ON rv.id=r.level_version_id WHERE rv.level_id=l.id AND r.status=$5))
        AND ($6='all' OR ($6='rated' AND cr.id IS NOT NULL) OR ($6='unrated' AND cr.id IS NULL))`
      const params = [search, family, tier, technique, referenceStatus, rated]
      const [count, rows] = await Promise.all([
        db.query(`SELECT count(*)::int AS count FROM levels l LEFT JOIN canonical_ratings cr ON cr.level_version_id=l.current_version_id AND cr.effective_to IS NULL WHERE ${where}`, params),
        db.query(
          `SELECT l.id,l.song,l.title,l.artist,l.creator,l.effecter,l.status,l.current_version_id,l.updated_at,
                  cr.family,cr.tier,cr.confidence,
                  (SELECT count(*)::int FROM rating_votes rv WHERE rv.level_version_id=l.current_version_id) AS vote_count,
                  (SELECT count(*)::int FROM difficulty_references r JOIN level_versions rv ON rv.id=r.level_version_id WHERE rv.level_id=l.id AND r.status<>'RETIRED') AS reference_count
           FROM levels l LEFT JOIN canonical_ratings cr ON cr.level_version_id=l.current_version_id AND cr.effective_to IS NULL
           WHERE ${where} ORDER BY ${orderBy} LIMIT $7 OFFSET $8`,
          [...params, limit, offset],
        ),
      ])
      return {
        total: Number(count.rows[0]?.count ?? 0),
        levels: rows.rows.map((row) => ({
          id: row.id, song: row.song, title: row.title, artist: row.artist, creator: row.creator, effecter: row.effecter,
          status: row.status, currentVersionId: row.current_version_id,
          currentRating: row.family ? { family: row.family, tier: Number(row.tier), confidence: row.confidence === null ? null : Number(row.confidence) } : null,
          voteCount: Number(row.vote_count ?? 0), referenceCount: Number(row.reference_count ?? 0),
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
         FROM levels l LEFT JOIN canonical_ratings cr ON cr.level_version_id=l.current_version_id AND cr.effective_to IS NULL
         WHERE l.id=$1 AND l.status<>'ARCHIVED'`, [id],
      )
      if (!levelResult.rowCount) return null
      const level = levelResult.rows[0]
      const [versions, ratings, voteSummary, ratingVotes, references] = await Promise.all([
        db.query(`SELECT lv.id,lv.label,lv.sha256,lv.download_url,lv.video_url,lv.notes,lv.created_at,cr.family,cr.tier,cr.confidence FROM level_versions lv LEFT JOIN canonical_ratings cr ON cr.level_version_id=lv.id AND cr.effective_to IS NULL WHERE lv.level_id=$1 ORDER BY lv.created_at DESC`, [id]),
        db.query(`SELECT cr.id,cr.level_version_id,lv.label AS version_label,cr.family,cr.tier,cr.confidence,cr.reason,cr.effective_from,cr.effective_to FROM canonical_ratings cr JOIN level_versions lv ON lv.id=cr.level_version_id WHERE lv.level_id=$1 ORDER BY cr.effective_from DESC`, [id]),
        db.query(`SELECT rv.family,rv.anchor_tier,count(*)::int AS count,percentile_cont(0.5) WITHIN GROUP (ORDER BY rv.anchor_tier+rv.lean*0.2) AS median_evidence,avg(rv.anchor_tier+rv.lean*0.2) AS mean_evidence FROM rating_votes rv JOIN level_versions lv ON lv.id=rv.level_version_id WHERE lv.level_id=$1 GROUP BY rv.family,rv.anchor_tier ORDER BY rv.family,rv.anchor_tier`, [id]),
        db.query(`SELECT rv.user_id,u.display_name,rv.level_version_id,lv.label AS version_label,rv.family,rv.anchor_tier,rv.lean,rv.confidence,rv.comment,rv.updated_at FROM rating_votes rv JOIN level_versions lv ON lv.id=rv.level_version_id JOIN users u ON u.id=rv.user_id WHERE lv.level_id=$1 ORDER BY rv.updated_at DESC`, [id]),
        db.query(`SELECT r.id,r.level_version_id,lv.label AS version_label,r.family,r.tier,r.technique,r.position_hint,r.status,r.confidence,r.notes FROM difficulty_references r JOIN level_versions lv ON lv.id=r.level_version_id WHERE lv.level_id=$1 ORDER BY r.status,r.family,r.tier,r.technique`, [id]),
      ])
      return {
        id: level.id, song: level.song, title: level.title, artist: level.artist, creator: level.creator, effecter: level.effecter,
        status: level.status, currentVersionId: level.current_version_id,
        currentRating: level.family ? { family: level.family, tier: Number(level.tier), confidence: level.confidence === null ? null : Number(level.confidence) } : null,
        voteCount: Number(level.vote_count ?? 0), referenceCount: references.rows.filter((row) => row.status !== 'RETIRED').length,
        versions: versions.rows.map((row) => ({ id: row.id,label: row.label,sha256: row.sha256,downloadUrl: row.download_url,videoUrl: row.video_url,notes: row.notes,createdAt: row.created_at,currentRating: row.family ? { family: row.family,tier: Number(row.tier),confidence: row.confidence === null ? null : Number(row.confidence) } : null })),
        ratingHistory: ratings.rows.map((row) => ({ id: row.id,levelVersionId: row.level_version_id,versionLabel: row.version_label,family: row.family,tier: Number(row.tier),confidence: row.confidence === null ? null : Number(row.confidence),reason: row.reason,effectiveFrom: row.effective_from,effectiveTo: row.effective_to })),
        voteSummary: voteSummary.rows.map((row) => ({ family: row.family,anchorTier: Number(row.anchor_tier),count: Number(row.count),medianEvidence: Number(row.median_evidence),meanEvidence: Number(row.mean_evidence) })),
        ratingVotes: ratingVotes.rows.map((row) => ({ userId: row.user_id,displayName: row.display_name,levelVersionId: row.level_version_id,versionLabel: row.version_label,family: row.family,anchorTier: Number(row.anchor_tier),lean: Number(row.lean),confidence: Number(row.confidence),comment: row.comment,updatedAt: row.updated_at })),
        references: references.rows.map((row) => ({ id: row.id,levelVersionId: row.level_version_id,versionLabel: row.version_label,family: row.family,tier: Number(row.tier),technique: row.technique,positionHint: row.position_hint === null ? null : Number(row.position_hint),status: row.status,confidence: row.confidence === null ? null : Number(row.confidence),notes: row.notes })),
      }
    })
    if (!detail) return c.json({ error: 'Level not found' }, 404)
    return c.json(detail)
  })
}
