import type { Hono } from 'hono'
import type { AppBindings } from './auth'
import { loadUser, requireRole } from './auth'
import { inTransaction, withDb } from './db'
import { audit } from './services'

const KINDS = new Set(['ORIGINAL','NERFED','BUFFED','KEYLIMIT','NO_KEY_LIMIT','CUSTOM'])

function clean(value: unknown, max = 1000): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, max) : null
}

function validSha(value: string | null): boolean {
  return value === null || /^[a-f0-9]{64}$/i.test(value)
}

function serializeVariant(row: any, versions: any[] = []) {
  return {
    id: row.id,
    levelId: row.level_id,
    name: row.name,
    kind: row.kind,
    keyLimit: row.key_limit === null ? null : Number(row.key_limit),
    notes: row.notes,
    isPrimary: !!row.is_primary,
    currentVersionId: row.current_version_id,
    currentRating: row.family ? { family: row.family, tier: Number(row.tier), confidence: row.confidence === null ? null : Number(row.confidence) } : null,
    versions: versions.map((version) => ({
      id: version.id,
      variantId: version.variant_id,
      label: version.label,
      sha256: version.sha256,
      downloadUrl: version.download_url,
      videoUrl: version.video_url,
      notes: version.notes,
      createdAt: version.created_at,
      currentRating: version.family ? { family: version.family, tier: Number(version.tier), confidence: version.confidence === null ? null : Number(version.confidence) } : null,
    })),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function registerLevelVariantRoutes(app: Hono<AppBindings>) {
  app.use('/api/admin/levels/:id/variants', loadUser)
  app.use('/api/admin/levels/:id/variants/*', loadUser)

  app.get('/api/levels/:id/variants', async (c) => {
    const result = await withDb(c.env, async (db) => {
      const variants = await db.query(
        `SELECT v.*,cr.family,cr.tier,cr.confidence
         FROM level_variants v
         LEFT JOIN canonical_ratings cr ON cr.level_version_id=v.current_version_id AND cr.effective_to IS NULL
         WHERE v.level_id=$1
         ORDER BY v.is_primary DESC,v.created_at,v.name`,
        [c.req.param('id')],
      )
      if (!variants.rowCount) return []
      const versions = await db.query(
        `SELECT lv.*,cr.family,cr.tier,cr.confidence
         FROM level_versions lv
         LEFT JOIN canonical_ratings cr ON cr.level_version_id=lv.id AND cr.effective_to IS NULL
         WHERE lv.level_id=$1
         ORDER BY lv.created_at DESC`,
        [c.req.param('id')],
      )
      return variants.rows.map((variant) => serializeVariant(variant, versions.rows.filter((version) => version.variant_id === variant.id)))
    })
    return c.json({ variants: result })
  })

  app.post('/api/admin/levels/:id/variants', requireRole('MODERATOR'), async (c) => {
    const user = c.get('user')!
    const body = await c.req.json<any>().catch(() => ({}))
    const name = clean(body.name, 120)
    const kind = (clean(body.kind, 40) ?? 'CUSTOM').toUpperCase()
    const keyLimit = body.keyLimit === null || body.keyLimit === undefined || body.keyLimit === '' ? null : Number(body.keyLimit)
    const notes = clean(body.notes, 2000)
    if (!name) return c.json({ error: 'name is required' }, 400)
    if (!KINDS.has(kind)) return c.json({ error: 'Invalid variant kind' }, 400)
    if (keyLimit !== null && (!Number.isInteger(keyLimit) || keyLimit < 1)) return c.json({ error: 'keyLimit must be a positive integer' }, 400)
    if (kind === 'KEYLIMIT' && keyLimit === null) return c.json({ error: 'KEYLIMIT variants require keyLimit' }, 400)

    const result = await withDb(c.env, async (db) => inTransaction(db, async () => {
      const level = await db.query(`SELECT id FROM levels WHERE id=$1 FOR UPDATE`, [c.req.param('id')])
      if (!level.rowCount) return null
      const inserted = await db.query(
        `INSERT INTO level_variants(level_id,name,kind,key_limit,notes,is_primary)
         VALUES ($1,$2,$3,$4,$5,false) RETURNING *`,
        [c.req.param('id'), name, kind, keyLimit, notes],
      )
      await audit(db, user.id, 'LEVEL_VARIANT_CREATE', 'level_variant', inserted.rows[0].id, { levelId: c.req.param('id'), name, kind, keyLimit })
      return inserted.rows[0]
    }))
    if (!result) return c.json({ error: 'Level not found' }, 404)
    return c.json({ variant: serializeVariant(result) }, 201)
  })

  app.patch('/api/admin/levels/:id/variants/:variantId', requireRole('MODERATOR'), async (c) => {
    const user = c.get('user')!
    const body = await c.req.json<any>().catch(() => ({}))
    const name = body.name === undefined ? null : clean(body.name, 120)
    const kindRaw = body.kind === undefined ? null : clean(body.kind, 40)?.toUpperCase() ?? null
    const keyLimitProvided = Object.prototype.hasOwnProperty.call(body, 'keyLimit')
    const keyLimit = !keyLimitProvided || body.keyLimit === null || body.keyLimit === '' ? null : Number(body.keyLimit)
    const notesProvided = Object.prototype.hasOwnProperty.call(body, 'notes')
    const notes = notesProvided ? clean(body.notes, 2000) : null
    const currentVersionId = body.currentVersionId === undefined ? null : clean(body.currentVersionId, 80)
    const makePrimary = body.isPrimary === true
    if (body.name !== undefined && !name) return c.json({ error: 'name cannot be empty' }, 400)
    if (kindRaw !== null && !KINDS.has(kindRaw)) return c.json({ error: 'Invalid variant kind' }, 400)
    if (keyLimitProvided && keyLimit !== null && (!Number.isInteger(keyLimit) || keyLimit < 1)) return c.json({ error: 'keyLimit must be a positive integer' }, 400)

    const result = await withDb(c.env, async (db) => inTransaction(db, async () => {
      const locked = await db.query(`SELECT * FROM level_variants WHERE id=$1 AND level_id=$2 FOR UPDATE`, [c.req.param('variantId'), c.req.param('id')])
      if (!locked.rowCount) return null
      if (currentVersionId) {
        const version = await db.query(`SELECT id FROM level_versions WHERE id=$1 AND variant_id=$2`, [currentVersionId, c.req.param('variantId')])
        if (!version.rowCount) throw new Error('currentVersionId must belong to this Variant')
      }
      if (makePrimary) await db.query(`UPDATE level_variants SET is_primary=false,updated_at=now() WHERE level_id=$1 AND id<>$2`, [c.req.param('id'), c.req.param('variantId')])
      const updated = await db.query(
        `UPDATE level_variants SET
           name=COALESCE($3,name),kind=COALESCE($4,kind),
           key_limit=CASE WHEN $5::boolean THEN $6 ELSE key_limit END,
           notes=CASE WHEN $7::boolean THEN $8 ELSE notes END,
           current_version_id=COALESCE($9,current_version_id),
           is_primary=CASE WHEN $10::boolean THEN true ELSE is_primary END,
           updated_at=now()
         WHERE id=$1 AND level_id=$2 RETURNING *`,
        [c.req.param('variantId'), c.req.param('id'), name, kindRaw, keyLimitProvided, keyLimit, notesProvided, notes, currentVersionId, makePrimary],
      )
      if (makePrimary && updated.rows[0].current_version_id) {
        await db.query(`UPDATE levels SET current_version_id=$2,updated_at=now() WHERE id=$1`, [c.req.param('id'), updated.rows[0].current_version_id])
      }
      await audit(db, user.id, 'LEVEL_VARIANT_UPDATE', 'level_variant', c.req.param('variantId'), { name, kind: kindRaw, keyLimit: keyLimitProvided ? keyLimit : undefined, currentVersionId, makePrimary })
      return updated.rows[0]
    }))
    if (!result) return c.json({ error: 'Variant not found' }, 404)
    return c.json({ variant: serializeVariant(result) })
  })

  app.post('/api/admin/levels/:id/variants/:variantId/versions', requireRole('MODERATOR'), async (c) => {
    const user = c.get('user')!
    const body = await c.req.json<any>().catch(() => ({}))
    const label = clean(body.label, 120)
    const sha256 = clean(body.sha256, 64)?.toLowerCase() ?? null
    if (!label) return c.json({ error: 'label is required' }, 400)
    if (!validSha(sha256)) return c.json({ error: 'sha256 must be 64 hexadecimal characters' }, 400)

    const result = await withDb(c.env, async (db) => inTransaction(db, async () => {
      const variant = await db.query(`SELECT * FROM level_variants WHERE id=$1 AND level_id=$2 FOR UPDATE`, [c.req.param('variantId'), c.req.param('id')])
      if (!variant.rowCount) return null
      const inserted = await db.query(
        `INSERT INTO level_versions(level_id,variant_id,label,sha256,download_url,video_url,notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [c.req.param('id'), c.req.param('variantId'), label, sha256, clean(body.downloadUrl, 2000), clean(body.videoUrl, 2000), clean(body.notes, 2000)],
      )
      if (body.makeCurrent !== false) {
        await db.query(`UPDATE level_variants SET current_version_id=$2,updated_at=now() WHERE id=$1`, [c.req.param('variantId'), inserted.rows[0].id])
        if (variant.rows[0].is_primary) await db.query(`UPDATE levels SET current_version_id=$2,updated_at=now() WHERE id=$1`, [c.req.param('id'), inserted.rows[0].id])
      }
      await audit(db, user.id, 'LEVEL_VERSION_CREATE', 'level_version', inserted.rows[0].id, { levelId: c.req.param('id'), variantId: c.req.param('variantId') })
      return inserted.rows[0]
    }))
    if (!result) return c.json({ error: 'Variant not found' }, 404)
    return c.json({ version: result }, 201)
  })
}
