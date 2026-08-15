import { Hono } from 'hono'
import type { Family, ProposalType, ReferenceStatus, UserRole } from '@elf/shared'
import type { AppBindings } from './auth'
import { hasRole, loadUser, requireRole } from './auth'
import { hashPassword, randomToken, sha256Hex, verifyPassword } from './crypto'
import { withDb, inTransaction } from './db'
import { allowedOrigin, clearSessionCookie, sessionCookie } from './http'
import {
  audit,
  normalizeConfidence,
  normalizeFamily,
  normalizeLean,
  normalizeTier,
  publishCanonicalRating,
  updateReferenceStatus,
} from './services'

const app = new Hono<AppBindings>()

app.use('*', async (c, next) => {
  const origin = c.req.header('Origin')
  const allowed = allowedOrigin(c.env, origin)
  if (c.req.method === 'OPTIONS') {
    if (!allowed) return c.body(null, 204)
    return c.body(null, 204, {
      'Access-Control-Allow-Origin': allowed,
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
      'Vary': 'Origin',
    })
  }
  await next()
  if (allowed) {
    c.header('Access-Control-Allow-Origin', allowed)
    c.header('Access-Control-Allow-Credentials', 'true')
    c.header('Vary', 'Origin')
  }
})

app.use('/api/*', loadUser)

app.onError((error, c) => {
  console.error(error)
  return c.json({ error: 'Internal server error' }, 500)
})

app.get('/api/health', async (c) => {
  const database = await withDb(c.env, async (db) => {
    const result = await db.query('SELECT 1 AS ok')
    return result.rows[0]?.ok === 1
  }).catch(() => false)
  return c.json({ ok: database, database, version: '0.3.0' }, database ? 200 : 503)
})

app.get('/api/config', (c) => c.json({
  version: '0.3.0',
  canonicalRating: 'integer-tier',
  voteScale: 'anchor-tier + five-step lean (-2..2), evidence only',
}))

app.get('/api/auth/me', (c) => c.json({ user: c.get('user') }))

app.post('/api/auth/login', async (c) => {
  const body = await c.req.json<{ email?: string; password?: string }>().catch((): { email?: string; password?: string } => ({}))
  const email = body.email?.trim().toLowerCase()
  const password = body.password ?? ''
  if (!email || !password) return c.json({ error: 'Email and password are required' }, 400)

  const result = await withDb(c.env, async (db) => {
    let userResult = await db.query(
      `SELECT id, email, display_name, role, password_hash FROM users WHERE lower(email) = $1`,
      [email],
    )

    if (!userResult.rowCount &&
        c.env.BOOTSTRAP_ADMIN_EMAIL?.toLowerCase() === email &&
        c.env.BOOTSTRAP_ADMIN_PASSWORD === password) {
      const passwordHash = await hashPassword(password)
      userResult = await db.query(
        `INSERT INTO users(email, display_name, role, password_hash)
         VALUES ($1, $2, 'ADMIN', $3)
         RETURNING id, email, display_name, role, password_hash`,
        [email, email.split('@')[0] ?? 'admin', passwordHash],
      )
      await audit(db, userResult.rows[0].id, 'BOOTSTRAP_ADMIN', 'user', userResult.rows[0].id, {})
    }

    if (!userResult.rowCount) return null
    const userRow = userResult.rows[0]
    if (!await verifyPassword(password, userRow.password_hash)) return null

    const token = randomToken()
    const tokenHash = await sha256Hex(token)
    await db.query(
      `INSERT INTO sessions(user_id, token_hash, expires_at)
       VALUES ($1, $2, now() + interval '14 days')`,
      [userRow.id, tokenHash],
    )
    return {
      token,
      user: {
        id: userRow.id,
        email: userRow.email,
        displayName: userRow.display_name,
        role: userRow.role,
      },
    }
  })

  if (!result) return c.json({ error: 'Invalid credentials' }, 401)
  c.header('Set-Cookie', sessionCookie(c.env, result.token, 14 * 24 * 60 * 60))
  return c.json({ user: result.user })
})

app.post('/api/auth/logout', async (c) => {
  const cookie = c.req.header('Cookie') ?? ''
  const tokenMatch = /(?:^|;\s*)elf_session=([^;]+)/.exec(cookie)
  if (tokenMatch?.[1]) {
    const token = decodeURIComponent(tokenMatch[1])
    const tokenHash = await sha256Hex(token)
    await withDb(c.env, (db) => db.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash])).catch(() => undefined)
  }
  c.header('Set-Cookie', clearSessionCookie(c.env))
  return c.json({ ok: true })
})

app.get('/api/stats', async (c) => {
  const stats = await withDb(c.env, async (db) => {
    const result = await db.query(`
      SELECT
        (SELECT count(*)::int FROM levels WHERE status = 'LISTED') AS levels,
        (SELECT count(*)::int FROM difficulty_references WHERE status = 'ACTIVE') AS active_references,
        (SELECT count(*)::int FROM proposals WHERE status = 'OPEN') AS open_proposals,
        (SELECT count(*)::int FROM rating_votes) AS rating_votes
    `)
    const row = result.rows[0]
    return {
      levels: row.levels,
      activeReferences: row.active_references,
      openProposals: row.open_proposals,
      ratingVotes: row.rating_votes,
    }
  })
  return c.json(stats)
})

app.get('/api/levels', async (c) => {
  const search = (c.req.query('search') ?? '').trim()
  const family = normalizeFamily(c.req.query('family'))
  const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 50), 1), 100)
  const offset = Math.max(Number(c.req.query('offset') ?? 0), 0)
  const levels = await withDb(c.env, async (db) => {
    const result = await db.query(
      `SELECT l.id, l.song, l.title, l.creator, l.status, l.current_version_id,
              cr.family, cr.tier, cr.confidence,
              (SELECT count(*)::int FROM rating_votes rv WHERE rv.level_version_id = l.current_version_id) AS vote_count
       FROM levels l
       LEFT JOIN canonical_ratings cr
         ON cr.level_version_id = l.current_version_id AND cr.effective_to IS NULL
       WHERE l.status <> 'ARCHIVED'
         AND ($1 = '' OR l.title ILIKE '%' || $1 || '%' OR l.song ILIKE '%' || $1 || '%' OR l.creator ILIKE '%' || $1 || '%')
         AND ($2::text IS NULL OR cr.family = $2)
       ORDER BY cr.family NULLS LAST, cr.tier NULLS LAST, l.title
       LIMIT $3 OFFSET $4`,
      [search, family, limit, offset],
    )
    return result.rows.map((row) => ({
      id: row.id,
      song: row.song,
      title: row.title,
      creator: row.creator,
      status: row.status,
      currentVersionId: row.current_version_id,
      currentRating: row.family ? { family: row.family, tier: row.tier, confidence: row.confidence === null ? null : Number(row.confidence) } : null,
      voteCount: row.vote_count,
    }))
  })
  return c.json({ levels })
})

app.get('/api/levels/:id', async (c) => {
  const id = c.req.param('id')
  const detail = await withDb(c.env, async (db) => {
    const levelResult = await db.query(
      `SELECT l.*, cr.family, cr.tier, cr.confidence,
              (SELECT count(*)::int FROM rating_votes rv WHERE rv.level_version_id = l.current_version_id) AS vote_count
       FROM levels l
       LEFT JOIN canonical_ratings cr ON cr.level_version_id = l.current_version_id AND cr.effective_to IS NULL
       WHERE l.id = $1`,
      [id],
    )
    if (!levelResult.rowCount) return null
    const level = levelResult.rows[0]

    const [versions, ratings, votes, references] = await Promise.all([
      db.query(`SELECT id, label, sha256, download_url, notes, created_at FROM level_versions WHERE level_id = $1 ORDER BY created_at DESC`, [id]),
      db.query(
        `SELECT cr.id, cr.level_version_id, cr.family, cr.tier, cr.confidence, cr.reason, cr.effective_from, cr.effective_to
         FROM canonical_ratings cr JOIN level_versions lv ON lv.id = cr.level_version_id
         WHERE lv.level_id = $1 ORDER BY cr.effective_from DESC`, [id],
      ),
      db.query(
        `SELECT family, anchor_tier,
                count(*)::int AS count,
                percentile_cont(0.5) WITHIN GROUP (ORDER BY anchor_tier + lean * 0.2) AS median_evidence,
                avg(anchor_tier + lean * 0.2) AS mean_evidence
         FROM rating_votes rv JOIN level_versions lv ON lv.id = rv.level_version_id
         WHERE lv.level_id = $1
         GROUP BY family, anchor_tier ORDER BY family, anchor_tier`, [id],
      ),
      db.query(
        `SELECT r.id, r.family, r.tier, r.technique, r.position_hint, r.status, r.confidence
         FROM difficulty_references r JOIN level_versions lv ON lv.id = r.level_version_id
         WHERE lv.level_id = $1 ORDER BY r.family, r.tier, r.technique`, [id],
      ),
    ])

    return {
      id: level.id,
      song: level.song,
      title: level.title,
      creator: level.creator,
      status: level.status,
      currentVersionId: level.current_version_id,
      currentRating: level.family ? { family: level.family, tier: level.tier, confidence: level.confidence === null ? null : Number(level.confidence) } : null,
      voteCount: level.vote_count,
      versions: versions.rows.map((row) => ({ id: row.id, label: row.label, sha256: row.sha256, downloadUrl: row.download_url, notes: row.notes, createdAt: row.created_at })),
      ratingHistory: ratings.rows.map((row) => ({ id: row.id, levelVersionId: row.level_version_id, family: row.family, tier: row.tier, confidence: row.confidence === null ? null : Number(row.confidence), reason: row.reason, effectiveFrom: row.effective_from, effectiveTo: row.effective_to })),
      voteSummary: votes.rows.map((row) => ({ family: row.family, anchorTier: row.anchor_tier, count: row.count, medianEvidence: Number(row.median_evidence), meanEvidence: Number(row.mean_evidence) })),
      references: references.rows.map((row) => ({ id: row.id, family: row.family, tier: row.tier, technique: row.technique, positionHint: row.position_hint, status: row.status, confidence: row.confidence === null ? null : Number(row.confidence) })),
    }
  })
  if (!detail) return c.json({ error: 'Level not found' }, 404)
  return c.json(detail)
})

app.post('/api/levels/:id/votes', requireRole('RATER'), async (c) => {
  const user = c.get('user')!
  const body = await c.req.json<any>().catch(() => ({}))
  const family = normalizeFamily(body.family)
  const anchorTier = normalizeTier(body.anchorTier)
  const lean = normalizeLean(body.lean)
  const confidence = Number(body.confidence ?? 3)
  if (!family || anchorTier === null || lean === null || !Number.isInteger(confidence) || confidence < 1 || confidence > 5) {
    return c.json({ error: 'Invalid vote. family, anchorTier, lean(-2..2), confidence(1..5) are required.' }, 400)
  }
  const levelId = c.req.param('id')
  const vote = await withDb(c.env, async (db) => {
    const version = await db.query('SELECT current_version_id FROM levels WHERE id = $1', [levelId])
    const versionId = version.rows[0]?.current_version_id
    if (!versionId) return null
    const result = await db.query(
      `INSERT INTO rating_votes(level_version_id, user_id, family, anchor_tier, lean, confidence, comment)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT(level_version_id, user_id, family)
       DO UPDATE SET anchor_tier = EXCLUDED.anchor_tier, lean = EXCLUDED.lean,
                     confidence = EXCLUDED.confidence, comment = EXCLUDED.comment, updated_at = now()
       RETURNING *`,
      [versionId, user.id, family, anchorTier, lean, confidence, body.comment ?? null],
    )
    await audit(db, user.id, 'RATING_VOTE', 'level_version', versionId, { family, anchorTier, lean, confidence })
    return result.rows[0]
  })
  if (!vote) return c.json({ error: 'Level/current version not found' }, 404)
  return c.json({ vote })
})

app.get('/api/references', async (c) => {
  const family = normalizeFamily(c.req.query('family'))
  const tier = c.req.query('tier') ? normalizeTier(c.req.query('tier')) : null
  const status = c.req.query('status') || null
  const references = await withDb(c.env, async (db) => {
    const result = await db.query(
      `SELECT r.*, lv.level_id, l.title AS level_title
       FROM difficulty_references r
       JOIN level_versions lv ON lv.id = r.level_version_id
       JOIN levels l ON l.id = lv.level_id
       WHERE ($1::text IS NULL OR r.family = $1)
         AND ($2::int IS NULL OR r.tier = $2)
         AND ($3::text IS NULL OR r.status = $3)
       ORDER BY r.family, r.tier, r.technique, l.title`,
      [family, tier, status],
    )
    return result.rows.map((row) => ({
      id: row.id, levelId: row.level_id, levelVersionId: row.level_version_id,
      levelTitle: row.level_title, family: row.family, tier: row.tier,
      technique: row.technique, positionHint: row.position_hint, status: row.status,
      confidence: row.confidence === null ? null : Number(row.confidence), notes: row.notes,
    }))
  })
  return c.json({ references })
})

app.get('/api/references/coverage', async (c) => {
  const coverage = await withDb(c.env, async (db) => {
    const result = await db.query(
      `SELECT family, tier, technique,
              count(*) FILTER (WHERE status='ACTIVE')::int AS active,
              count(*) FILTER (WHERE status='NEEDS_REVIEW')::int AS needs_review
       FROM difficulty_references
       GROUP BY family, tier, technique
       ORDER BY family, tier, technique`,
    )
    return result.rows
  })
  return c.json({ coverage })
})

app.get('/api/proposals', async (c) => {
  const status = c.req.query('status') || null
  const proposals = await withDb(c.env, async (db) => {
    const result = await db.query(
      `SELECT p.*, l.title AS level_title, u.display_name AS proposer_name,
              count(*) FILTER (WHERE pv.vote='AGREE')::int AS agree,
              count(*) FILTER (WHERE pv.vote='DISAGREE')::int AS disagree,
              count(*) FILTER (WHERE pv.vote='ABSTAIN')::int AS abstain
       FROM proposals p
       JOIN levels l ON l.id = p.level_id
       JOIN users u ON u.id = p.proposer_id
       LEFT JOIN proposal_votes pv ON pv.proposal_id = p.id
       WHERE ($1::text IS NULL OR p.status = $1)
       GROUP BY p.id, l.title, u.display_name
       ORDER BY p.created_at DESC LIMIT 200`,
      [status],
    )
    return result.rows.map((row) => ({
      id: row.id, type: row.type, levelId: row.level_id, levelTitle: row.level_title,
      title: row.title, payload: row.payload, reason: row.reason, status: row.status,
      proposerName: row.proposer_name, createdAt: row.created_at,
      agree: row.agree, disagree: row.disagree, abstain: row.abstain,
      decisionReason: row.decision_reason,
    }))
  })
  return c.json({ proposals })
})

app.post('/api/proposals', requireRole('VIEWER'), async (c) => {
  const user = c.get('user')!
  const body = await c.req.json<any>().catch(() => ({}))
  const allowedTypes = ['RERATE','REFERENCE_ADD','REFERENCE_MOVE','REFERENCE_REMOVE','METADATA','OTHER']
  if (!allowedTypes.includes(body.type) || !body.levelId || !body.title?.trim() || !body.reason?.trim()) {
    return c.json({ error: 'type, levelId, title and reason are required' }, 400)
  }
  const proposal = await withDb(c.env, async (db) => {
    const result = await db.query(
      `INSERT INTO proposals(type, level_id, title, payload, reason, proposer_id)
       VALUES ($1,$2,$3,$4::jsonb,$5,$6) RETURNING *`,
      [body.type, body.levelId, body.title.trim(), JSON.stringify(body.payload ?? {}), body.reason.trim(), user.id],
    )
    await audit(db, user.id, 'PROPOSAL_CREATE', 'proposal', result.rows[0].id, { type: body.type })
    return result.rows[0]
  })
  return c.json({ proposal }, 201)
})

app.post('/api/proposals/:id/votes', requireRole('VIEWER'), async (c) => {
  const user = c.get('user')!
  const body = await c.req.json<any>().catch(() => ({}))
  if (!['AGREE','DISAGREE','ABSTAIN'].includes(body.vote)) return c.json({ error: 'Invalid vote' }, 400)
  await withDb(c.env, async (db) => {
    await db.query(
      `INSERT INTO proposal_votes(proposal_id,user_id,vote)
       VALUES ($1,$2,$3)
       ON CONFLICT(proposal_id,user_id) DO UPDATE SET vote=EXCLUDED.vote, updated_at=now()`,
      [c.req.param('id'), user.id, body.vote],
    )
  })
  return c.json({ ok: true })
})

// ----- Admin / staff -----

app.get('/api/admin/overview', requireRole('REFERENCE_MANAGER'), async (c) => {
  const overview = await withDb(c.env, async (db) => {
    const result = await db.query(`
      SELECT
        (SELECT count(*)::int FROM levels) AS levels,
        (SELECT count(*)::int FROM difficulty_references WHERE status='NEEDS_REVIEW') AS references_needing_review,
        (SELECT count(*)::int FROM proposals WHERE status='OPEN') AS open_proposals,
        (SELECT count(*)::int FROM users) AS users
    `)
    return result.rows[0]
  })
  return c.json(overview)
})

app.post('/api/admin/levels', requireRole('MODERATOR'), async (c) => {
  const user = c.get('user')!
  const body = await c.req.json<any>().catch(() => ({}))
  if (!body.song?.trim() || !body.title?.trim() || !body.creator?.trim() || !body.version?.label?.trim()) {
    return c.json({ error: 'song, title, creator and version.label are required' }, 400)
  }
  if (body.version.sha256 && !/^[a-fA-F0-9]{64}$/.test(body.version.sha256)) return c.json({ error: 'sha256 must be 64 hex chars' }, 400)

  const created = await withDb(c.env, async (db) => inTransaction(db, async () => {
    const level = await db.query(
      `INSERT INTO levels(song,title,creator,status) VALUES ($1,$2,$3,$4) RETURNING *`,
      [body.song.trim(), body.title.trim(), body.creator.trim(), body.status ?? 'LISTED'],
    )
    const version = await db.query(
      `INSERT INTO level_versions(level_id,label,sha256,download_url,notes)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [level.rows[0].id, body.version.label.trim(), body.version.sha256?.toLowerCase() ?? null, body.version.downloadUrl ?? null, body.version.notes ?? null],
    )
    await db.query('UPDATE levels SET current_version_id=$2, updated_at=now() WHERE id=$1', [level.rows[0].id, version.rows[0].id])
    await audit(db, user.id, 'LEVEL_CREATE', 'level', level.rows[0].id, { versionId: version.rows[0].id })
    return { level: level.rows[0], version: version.rows[0] }
  }))
  return c.json(created, 201)
})

app.patch('/api/admin/levels/:id', requireRole('MODERATOR'), async (c) => {
  const user = c.get('user')!
  const body = await c.req.json<any>().catch(() => ({}))
  const updated = await withDb(c.env, async (db) => {
    const result = await db.query(
      `UPDATE levels SET
         song=COALESCE($2,song), title=COALESCE($3,title), creator=COALESCE($4,creator),
         status=COALESCE($5,status), updated_at=now()
       WHERE id=$1 RETURNING *`,
      [c.req.param('id'), body.song ?? null, body.title ?? null, body.creator ?? null, body.status ?? null],
    )
    if (result.rowCount) await audit(db, user.id, 'LEVEL_UPDATE', 'level', c.req.param('id'), body)
    return result.rows[0] ?? null
  })
  if (!updated) return c.json({ error: 'Level not found' }, 404)
  return c.json({ level: updated })
})

app.post('/api/admin/levels/:id/versions', requireRole('MODERATOR'), async (c) => {
  const user = c.get('user')!
  const body = await c.req.json<any>().catch(() => ({}))
  if (!body.label?.trim()) return c.json({ error: 'label is required' }, 400)
  if (body.sha256 && !/^[a-fA-F0-9]{64}$/.test(body.sha256)) return c.json({ error: 'sha256 must be 64 hex chars' }, 400)
  const version = await withDb(c.env, async (db) => inTransaction(db, async () => {
    const inserted = await db.query(
      `INSERT INTO level_versions(level_id,label,sha256,download_url,notes)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [c.req.param('id'), body.label.trim(), body.sha256?.toLowerCase() ?? null, body.downloadUrl ?? null, body.notes ?? null],
    )
    if (body.makeCurrent !== false) await db.query('UPDATE levels SET current_version_id=$2,updated_at=now() WHERE id=$1', [c.req.param('id'), inserted.rows[0].id])
    await audit(db, user.id, 'LEVEL_VERSION_CREATE', 'level_version', inserted.rows[0].id, { levelId: c.req.param('id') })
    return inserted.rows[0]
  }))
  return c.json({ version }, 201)
})

app.post('/api/admin/levels/:id/ratings', requireRole('MODERATOR'), async (c) => {
  const user = c.get('user')!
  const body = await c.req.json<any>().catch(() => ({}))
  const family = normalizeFamily(body.family)
  const tier = normalizeTier(body.tier)
  const confidence = normalizeConfidence(body.confidence)
  if (!body.levelVersionId || !family || tier === null) return c.json({ error: 'levelVersionId, family and integer tier are required' }, 400)
  const result = await withDb(c.env, (db) => publishCanonicalRating(db, {
    levelVersionId: body.levelVersionId,
    expectedLevelId: c.req.param('id'),
    family,
    tier,
    confidence,
    reason: body.reason ?? null,
    actorId: user.id,
  }))
  return c.json(result)
})

app.post('/api/admin/references', requireRole('REFERENCE_MANAGER'), async (c) => {
  const user = c.get('user')!
  const body = await c.req.json<any>().catch(() => ({}))
  const family = normalizeFamily(body.family)
  const tier = normalizeTier(body.tier)
  const positionHint = body.positionHint === null || body.positionHint === undefined ? null : normalizeLean(body.positionHint)
  const confidence = normalizeConfidence(body.confidence)
  if (!body.levelVersionId || !family || tier === null || !body.technique?.trim()) return c.json({ error: 'levelVersionId, family, tier and technique are required' }, 400)
  if (body.positionHint !== null && body.positionHint !== undefined && positionHint === null) return c.json({ error: 'positionHint must be -2..2 or null' }, 400)

  const reference = await withDb(c.env, async (db) => inTransaction(db, async () => {
    const canonical = await db.query(
      `SELECT family, tier FROM canonical_ratings WHERE level_version_id=$1 AND effective_to IS NULL`,
      [body.levelVersionId],
    )
    const matchesCanonical = canonical.rowCount === 1 && canonical.rows[0].family === family && canonical.rows[0].tier === tier
    const initialStatus = matchesCanonical ? 'ACTIVE' : 'NEEDS_REVIEW'
    const inserted = await db.query(
      `INSERT INTO difficulty_references(level_version_id,family,tier,technique,position_hint,status,confidence,notes,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [body.levelVersionId, family, tier, body.technique.trim().toUpperCase(), positionHint, initialStatus, confidence, body.notes ?? null, user.id],
    )
    await db.query(
      `INSERT INTO reference_history(reference_id,action,new_data,actor_id)
       VALUES ($1,'CREATED',$2::jsonb,$3)`,
      [inserted.rows[0].id, JSON.stringify({ ...inserted.rows[0], canonicalMatchAtCreation: matchesCanonical }), user.id],
    )
    await audit(db, user.id, 'REFERENCE_CREATE', 'reference', inserted.rows[0].id, { family, tier, technique: body.technique, initialStatus })
    return inserted.rows[0]
  }))
  return c.json({ reference }, 201)
})

app.patch('/api/admin/references/:id', requireRole('REFERENCE_MANAGER'), async (c) => {
  const user = c.get('user')!
  const body = await c.req.json<any>().catch(() => ({}))
  if (body.status) {
    if (!['ACTIVE','NEEDS_REVIEW','RETIRED'].includes(body.status)) return c.json({ error: 'Invalid status' }, 400)
    const reference = await withDb(c.env, (db) => updateReferenceStatus(db, c.req.param('id'), body.status as ReferenceStatus, user.id, body.notes))
    return c.json({ reference })
  }
  return c.json({ error: 'Currently only status/notes updates are supported; use a proposal for slot movement.' }, 400)
})

app.patch('/api/admin/proposals/:id/decision', requireRole('MODERATOR'), async (c) => {
  const user = c.get('user')!
  const body = await c.req.json<any>().catch(() => ({}))
  if (!['APPROVED','REJECTED','WITHDRAWN'].includes(body.status)) return c.json({ error: 'Invalid decision status' }, 400)
  const proposal = await withDb(c.env, async (db) => {
    const result = await db.query(
      `UPDATE proposals SET status=$2, decision_reason=$3, decided_by=$4, decided_at=now(), updated_at=now()
       WHERE id=$1 AND status='OPEN' RETURNING *`,
      [c.req.param('id'), body.status, body.reason ?? null, user.id],
    )
    if (result.rowCount) await audit(db, user.id, 'PROPOSAL_DECISION', 'proposal', c.req.param('id'), { status: body.status, reason: body.reason })
    return result.rows[0] ?? null
  })
  if (!proposal) return c.json({ error: 'Open proposal not found' }, 404)
  return c.json({ proposal })
})

app.get('/api/admin/users', requireRole('ADMIN'), async (c) => {
  const users = await withDb(c.env, async (db) => {
    const result = await db.query('SELECT id,email,display_name,role,created_at,updated_at FROM users ORDER BY created_at')
    return result.rows
  })
  return c.json({ users })
})

app.post('/api/admin/users', requireRole('ADMIN'), async (c) => {
  const actor = c.get('user')!
  const body = await c.req.json<any>().catch(() => ({}))
  const roles = ['VIEWER','RATER','REFERENCE_MANAGER','MODERATOR','ADMIN']
  if (!body.email?.trim() || !body.displayName?.trim() || !body.password || !roles.includes(body.role)) return c.json({ error: 'email, displayName, password, role required' }, 400)
  const passwordHash = await hashPassword(body.password)
  const user = await withDb(c.env, async (db) => {
    const result = await db.query(
      `INSERT INTO users(email,display_name,role,password_hash) VALUES ($1,$2,$3,$4)
       RETURNING id,email,display_name,role,created_at`,
      [body.email.trim().toLowerCase(), body.displayName.trim(), body.role, passwordHash],
    )
    await audit(db, actor.id, 'USER_CREATE', 'user', result.rows[0].id, { role: body.role })
    return result.rows[0]
  })
  return c.json({ user }, 201)
})

app.patch('/api/admin/users/:id/role', requireRole('ADMIN'), async (c) => {
  const actor = c.get('user')!
  const body = await c.req.json<any>().catch(() => ({}))
  const roles = ['VIEWER','RATER','REFERENCE_MANAGER','MODERATOR','ADMIN']
  if (!roles.includes(body.role)) return c.json({ error: 'Invalid role' }, 400)
  const user = await withDb(c.env, async (db) => {
    const result = await db.query('UPDATE users SET role=$2,updated_at=now() WHERE id=$1 RETURNING id,email,display_name,role', [c.req.param('id'), body.role])
    if (result.rowCount) await audit(db, actor.id, 'USER_ROLE', 'user', c.req.param('id'), { role: body.role })
    return result.rows[0] ?? null
  })
  if (!user) return c.json({ error: 'User not found' }, 404)
  return c.json({ user })
})

app.get('/api/admin/import-snapshots', requireRole('REFERENCE_MANAGER'), async (c) => {
  const snapshots = await withDb(c.env, async (db) => {
    const result = await db.query('SELECT id,source,source_version,imported_by,imported_at FROM import_snapshots ORDER BY imported_at DESC LIMIT 100')
    return result.rows
  })
  return c.json({ snapshots })
})

app.post('/api/admin/import-snapshots', requireRole('REFERENCE_MANAGER'), async (c) => {
  const user = c.get('user')!
  const body = await c.req.json<any>().catch(() => ({}))
  if (!body.source?.trim() || body.rawData === undefined) return c.json({ error: 'source and rawData are required' }, 400)
  const snapshot = await withDb(c.env, async (db) => {
    const result = await db.query(
      `INSERT INTO import_snapshots(source,source_version,raw_data,imported_by)
       VALUES ($1,$2,$3::jsonb,$4) RETURNING id,source,source_version,imported_at`,
      [body.source.trim(), body.sourceVersion ?? null, JSON.stringify(body.rawData), user.id],
    )
    await audit(db, user.id, 'IMPORT_SNAPSHOT', 'import_snapshot', result.rows[0].id, { source: body.source })
    return result.rows[0]
  })
  return c.json({ snapshot }, 201)
})

app.get('/api/admin/audit', requireRole('MODERATOR'), async (c) => {
  const rows = await withDb(c.env, async (db) => {
    const result = await db.query(
      `SELECT a.*, u.display_name AS actor_name
       FROM audit_log a LEFT JOIN users u ON u.id=a.actor_id
       ORDER BY a.created_at DESC LIMIT 250`,
    )
    return result.rows
  })
  return c.json({ audit: rows })
})

export default app
