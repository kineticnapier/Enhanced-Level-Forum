import type { Hono } from 'hono'
import type { AppBindings } from './auth'
import { loadUser, requireRole } from './auth'
import { inTransaction, withDb } from './db'
import { audit } from './services'

const PENDING_PER_USER_LIMIT = 5

function clean(value: unknown, max = 1000): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.slice(0, max)
}

function validSha(value: string | null): boolean {
  return value === null || /^[a-f0-9]{64}$/i.test(value)
}

function validUrl(value: string | null): boolean {
  if (value === null) return true
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

function serialize(row: any) {
  return {
    id: row.id,
    status: row.status,
    song: row.song,
    artist: row.artist,
    creator: row.creator,
    effecter: row.effecter,
    versionLabel: row.version_label,
    sha256: row.sha256,
    downloadUrl: row.download_url,
    videoUrl: row.video_url,
    notes: row.notes,
    reviewNote: row.review_note,
    submittedBy: row.submitted_by,
    submitterName: row.submitter_name ?? null,
    reviewedBy: row.reviewed_by,
    reviewerName: row.reviewer_name ?? null,
    reviewedAt: row.reviewed_at,
    createdLevelId: row.created_level_id,
    createdLevelVersionId: row.created_level_version_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function registerSubmissionRoutes(app: Hono<AppBindings>) {
  app.use('/api/submissions', loadUser)
  app.use('/api/submissions/*', loadUser)
  app.use('/api/admin/submissions', loadUser)
  app.use('/api/admin/submissions/*', loadUser)

  app.post('/api/submissions', requireRole('VIEWER'), async (c) => {
    const user = c.get('user')!
    const body = await c.req.json<any>().catch(() => ({}))
    const song = clean(body.song, 300)
    const artist = clean(body.artist, 300)
    const creator = clean(body.creator, 300)
    const effecter = clean(body.effecter, 300)
    const versionLabel = clean(body.versionLabel ?? body.version?.label, 120)
    const sha256 = clean(body.sha256 ?? body.version?.sha256, 64)?.toLowerCase() ?? null
    const downloadUrl = clean(body.downloadUrl ?? body.version?.downloadUrl, 2000)
    const videoUrl = clean(body.videoUrl ?? body.version?.videoUrl, 2000)
    const notes = clean(body.notes ?? body.version?.notes, 2000)

    if (!song || !artist || !creator || !versionLabel) {
      return c.json({ error: 'song, artist, creator and versionLabel are required' }, 400)
    }
    if (!validSha(sha256)) return c.json({ error: 'sha256 must be 64 hexadecimal characters' }, 400)
    if (!validUrl(downloadUrl) || !validUrl(videoUrl)) return c.json({ error: 'downloadUrl and videoUrl must use http or https' }, 400)

    const result = await withDb(c.env, async (db) => inTransaction(db, async () => {
      const pending = await db.query(
        `SELECT count(*)::int AS count FROM level_submissions WHERE submitted_by=$1 AND status='PENDING'`,
        [user.id],
      )
      if (Number(pending.rows[0]?.count ?? 0) >= PENDING_PER_USER_LIMIT) {
        return { error: `You can have at most ${PENDING_PER_USER_LIMIT} pending submissions.`, status: 429 as const }
      }

      if (sha256) {
        const existing = await db.query(`SELECT id,level_id FROM level_versions WHERE lower(sha256)=$1 LIMIT 1`, [sha256])
        if (existing.rowCount) return { error: 'A LevelVersion with this SHA-256 already exists.', status: 409 as const }
        const duplicate = await db.query(
          `SELECT id FROM level_submissions WHERE lower(sha256)=$1 AND status='PENDING' LIMIT 1`,
          [sha256],
        )
        if (duplicate.rowCount) return { error: 'A pending submission with this SHA-256 already exists.', status: 409 as const }
      } else {
        const duplicate = await db.query(
          `SELECT id FROM level_submissions
           WHERE submitted_by=$1 AND status='PENDING' AND lower(song)=lower($2) AND lower(artist)=lower($3)
             AND lower(creator)=lower($4) AND lower(version_label)=lower($5)
           LIMIT 1`,
          [user.id, song, artist, creator, versionLabel],
        )
        if (duplicate.rowCount) return { error: 'You already have a matching pending submission.', status: 409 as const }
      }

      const inserted = await db.query(
        `INSERT INTO level_submissions(
           submitted_by,song,artist,creator,effecter,version_label,sha256,download_url,video_url,notes
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [user.id, song, artist, creator, effecter, versionLabel, sha256, downloadUrl, videoUrl, notes],
      )
      await audit(db, user.id, 'LEVEL_SUBMISSION_CREATE', 'level_submission', inserted.rows[0].id, {
        song, artist, creator, versionLabel, hasSha256: !!sha256,
      })
      return { submission: serialize(inserted.rows[0]) }
    }))

    if ('error' in result) return c.json({ error: result.error }, result.status)
    return c.json(result, 201)
  })

  app.get('/api/submissions/mine', requireRole('VIEWER'), async (c) => {
    const user = c.get('user')!
    const result = await withDb(c.env, (db) => db.query(
      `SELECT s.*,r.display_name AS reviewer_name
       FROM level_submissions s LEFT JOIN users r ON r.id=s.reviewed_by
       WHERE s.submitted_by=$1 ORDER BY s.created_at DESC LIMIT 100`,
      [user.id],
    ))
    return c.json({ submissions: result.rows.map(serialize) })
  })

  app.post('/api/submissions/:id/withdraw', requireRole('VIEWER'), async (c) => {
    const user = c.get('user')!
    const result = await withDb(c.env, async (db) => {
      const updated = await db.query(
        `UPDATE level_submissions SET status='WITHDRAWN',updated_at=now()
         WHERE id=$1 AND submitted_by=$2 AND status='PENDING' RETURNING *`,
        [c.req.param('id'), user.id],
      )
      if (updated.rowCount) await audit(db, user.id, 'LEVEL_SUBMISSION_WITHDRAW', 'level_submission', c.req.param('id'), {})
      return updated.rows[0] ?? null
    })
    if (!result) return c.json({ error: 'Pending submission not found' }, 404)
    return c.json({ submission: serialize(result) })
  })

  app.get('/api/admin/submissions', requireRole('MODERATOR'), async (c) => {
    const status = (c.req.query('status') ?? 'PENDING').trim().toUpperCase()
    if (!['PENDING','APPROVED','REJECTED','WITHDRAWN','ALL'].includes(status)) return c.json({ error: 'Invalid status' }, 400)
    const result = await withDb(c.env, (db) => db.query(
      `SELECT s.*,u.display_name AS submitter_name,r.display_name AS reviewer_name
       FROM level_submissions s
       JOIN users u ON u.id=s.submitted_by
       LEFT JOIN users r ON r.id=s.reviewed_by
       WHERE ($1='ALL' OR s.status=$1)
       ORDER BY CASE WHEN s.status='PENDING' THEN 0 ELSE 1 END,s.created_at ASC
       LIMIT 200`,
      [status],
    ))
    return c.json({ submissions: result.rows.map(serialize) })
  })

  app.post('/api/admin/submissions/:id/approve', requireRole('MODERATOR'), async (c) => {
    const user = c.get('user')!
    const body = await c.req.json<any>().catch(() => ({}))
    const reviewNote = clean(body.reviewNote, 2000)
    const approved = await withDb(c.env, async (db) => inTransaction(db, async () => {
      const locked = await db.query(`SELECT * FROM level_submissions WHERE id=$1 FOR UPDATE`, [c.req.param('id')])
      if (!locked.rowCount) return { error: 'Submission not found', status: 404 as const }
      const submission = locked.rows[0]
      if (submission.status !== 'PENDING') return { error: `Submission is already ${submission.status}`, status: 409 as const }

      if (submission.sha256) {
        const existing = await db.query(`SELECT id FROM level_versions WHERE lower(sha256)=lower($1) LIMIT 1`, [submission.sha256])
        if (existing.rowCount) return { error: 'A LevelVersion with this SHA-256 already exists.', status: 409 as const }
      }

      const level = await db.query(
        `INSERT INTO levels(song,title,artist,creator,effecter,status)
         VALUES ($1,$1,$2,$3,$4,'LISTED') RETURNING *`,
        [submission.song, submission.artist, submission.creator, submission.effecter],
      )
      const version = await db.query(
        `INSERT INTO level_versions(level_id,label,sha256,download_url,video_url,notes)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [level.rows[0].id, submission.version_label, submission.sha256, submission.download_url, submission.video_url, submission.notes],
      )
      await db.query(`UPDATE levels SET current_version_id=$2,updated_at=now() WHERE id=$1`, [level.rows[0].id, version.rows[0].id])
      const updated = await db.query(
        `UPDATE level_submissions SET status='APPROVED',review_note=$2,reviewed_by=$3,reviewed_at=now(),
           created_level_id=$4,created_level_version_id=$5,updated_at=now()
         WHERE id=$1 RETURNING *`,
        [submission.id, reviewNote, user.id, level.rows[0].id, version.rows[0].id],
      )
      await audit(db, user.id, 'LEVEL_SUBMISSION_APPROVE', 'level_submission', submission.id, {
        levelId: level.rows[0].id, levelVersionId: version.rows[0].id,
        ratingQueue: 'not automatically enqueued',
      })
      await audit(db, user.id, 'LEVEL_CREATE_FROM_SUBMISSION', 'level', level.rows[0].id, {
        submissionId: submission.id, versionId: version.rows[0].id,
      })
      return { submission: serialize(updated.rows[0]), level: level.rows[0], version: version.rows[0] }
    }))
    if ('error' in approved) return c.json({ error: approved.error }, approved.status)
    return c.json(approved, 201)
  })

  app.post('/api/admin/submissions/:id/reject', requireRole('MODERATOR'), async (c) => {
    const user = c.get('user')!
    const body = await c.req.json<any>().catch(() => ({}))
    const reviewNote = clean(body.reviewNote, 2000)
    if (!reviewNote) return c.json({ error: 'reviewNote is required when rejecting a submission' }, 400)
    const result = await withDb(c.env, async (db) => {
      const updated = await db.query(
        `UPDATE level_submissions SET status='REJECTED',review_note=$2,reviewed_by=$3,reviewed_at=now(),updated_at=now()
         WHERE id=$1 AND status='PENDING' RETURNING *`,
        [c.req.param('id'), reviewNote, user.id],
      )
      if (updated.rowCount) await audit(db, user.id, 'LEVEL_SUBMISSION_REJECT', 'level_submission', c.req.param('id'), { reviewNote })
      return updated.rows[0] ?? null
    })
    if (!result) return c.json({ error: 'Pending submission not found' }, 404)
    return c.json({ submission: serialize(result) })
  })
}
