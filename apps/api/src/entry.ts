import { Hono } from 'hono'
import coreApp from './index'
import { requireRole, type AppBindings } from './auth'
import { withDb } from './db'
import { createTufRerateProposal, listTufEvidence, TufEvidenceError } from './evidence/tuf'
import { importTufSnapshot, type TufRawSnapshot } from './importers/tuf'
import { fetchConsistentTufSnapshot } from './importers/tuf-fetch'
import { registerLevelMetadataCatalogRoutes, registerLevelMetadataRoutes } from './level-metadata'
import { registerProductionAuth } from './production-auth'
import { registerPublicRoutes } from './public'
import { registerRatingQueueRoutes } from './rating-queue'
import { createLevelFromTufObservation, linkTufObservation, listTufUnlinked, TufReconciliationError } from './reconciliation/tuf'

type TufImportBody = { rawData?: TufRawSnapshot; sourceVersion?: string | null }
type TufLinkBody = { observationId?: string; levelId?: string; levelVersionId?: string | null }
type TufProposalBody = { observationId?: string; reason?: string | null }
type TufCreateLevelBody = {
  observationId?: string
  song?: string | null
  title?: string | null
  creator?: string | null
  status?: string | null
  version?: {
    label?: string | null
    sha256?: string | null
    downloadUrl?: string | null
    notes?: string | null
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

// Production security/auth routes are deliberately registered first. The
// practical Level metadata compatibility layer and queue-aware rating routes
// are next so they can replace the original v0.3 CRUD/vote handlers without
// removing old compatibility APIs.
const app = new Hono<AppBindings>()
registerProductionAuth(app)
registerLevelMetadataRoutes(app)
registerRatingQueueRoutes(app)
app.route('/', coreApp)
registerLevelMetadataCatalogRoutes(app)
registerPublicRoutes(app)

app.onError((error, c) => {
  console.error(error)
  return c.json({ error: 'Internal server error' }, 500)
})

app.post('/api/admin/imports/tuf', requireRole('REFERENCE_MANAGER'), async (c) => {
  const user = c.get('user')!
  const body = await c.req.json<TufImportBody>().catch((): TufImportBody => ({}))

  const rawData = body.rawData ?? await fetchConsistentTufSnapshot()
  const result = await withDb(c.env, (db) => importTufSnapshot(db, {
    rawData,
    actorId: user.id,
    sourceVersion: body.sourceVersion ?? null,
  }))

  return c.json(result, 201)
})

app.get('/api/admin/imports/tuf/unlinked', requireRole('REFERENCE_MANAGER'), async (c) => {
  const snapshotId = c.req.query('snapshotId')?.trim() || null
  if (snapshotId && !UUID_RE.test(snapshotId)) return c.json({ error: 'Invalid snapshotId' }, 400)

  const rawLimit = Number(c.req.query('limit') ?? 50)
  const rawOffset = Number(c.req.query('offset') ?? 0)
  const limit = Number.isFinite(rawLimit) ? Math.trunc(rawLimit) : 50
  const offset = Number.isFinite(rawOffset) ? Math.trunc(rawOffset) : 0

  try {
    const result = await withDb(c.env, (db) => listTufUnlinked(db, {
      snapshotId,
      search: c.req.query('search') ?? '',
      limit,
      offset,
    }))
    return c.json(result)
  } catch (error) {
    if (error instanceof TufReconciliationError) return c.json({ error: error.message }, error.status)
    throw error
  }
})

app.post('/api/admin/imports/tuf/link', requireRole('REFERENCE_MANAGER'), async (c) => {
  const user = c.get('user')!
  const body = await c.req.json<TufLinkBody>().catch((): TufLinkBody => ({}))
  const observationId = body.observationId?.trim() ?? ''
  const levelId = body.levelId?.trim() ?? ''
  const levelVersionId = body.levelVersionId?.trim() || null
  if (!UUID_RE.test(observationId) || !UUID_RE.test(levelId) || (levelVersionId && !UUID_RE.test(levelVersionId))) {
    return c.json({ error: 'observationId and levelId must be UUIDs; levelVersionId must be a UUID when supplied' }, 400)
  }

  try {
    const result = await withDb(c.env, (db) => linkTufObservation(db, {
      observationId,
      levelId,
      levelVersionId,
      actorId: user.id,
    }))
    return c.json(result)
  } catch (error) {
    if (error instanceof TufReconciliationError) return c.json({ error: error.message }, error.status)
    throw error
  }
})

// Kept for backwards-compatible source/API documentation. The practical
// metadata route is registered earlier and handles this path first.
app.post('/api/admin/imports/tuf/create-level', requireRole('MODERATOR'), async (c) => {
  const user = c.get('user')!
  const body = await c.req.json<TufCreateLevelBody>().catch((): TufCreateLevelBody => ({}))
  const observationId = body.observationId?.trim() ?? ''
  if (!UUID_RE.test(observationId)) return c.json({ error: 'observationId must be a UUID' }, 400)

  try {
    const result = await withDb(c.env, (db) => createLevelFromTufObservation(db, {
      observationId,
      song: body.song,
      title: body.title,
      creator: body.creator,
      status: body.status,
      versionLabel: body.version?.label,
      sha256: body.version?.sha256,
      downloadUrl: body.version?.downloadUrl,
      notes: body.version?.notes,
      actorId: user.id,
    }))
    return c.json(result, 201)
  } catch (error) {
    if (error instanceof TufReconciliationError) return c.json({ error: error.message }, error.status)
    throw error
  }
})

app.get('/api/admin/imports/tuf/evidence', requireRole('REFERENCE_MANAGER'), async (c) => {
  const snapshotId = c.req.query('snapshotId')?.trim() || null
  if (snapshotId && !UUID_RE.test(snapshotId)) return c.json({ error: 'Invalid snapshotId' }, 400)

  const rawLimit = Number(c.req.query('limit') ?? 50)
  const rawOffset = Number(c.req.query('offset') ?? 0)
  const limit = Number.isFinite(rawLimit) ? Math.trunc(rawLimit) : 50
  const offset = Number.isFinite(rawOffset) ? Math.trunc(rawOffset) : 0
  const actionableOnly = c.req.query('actionableOnly') === 'true'

  try {
    const result = await withDb(c.env, (db) => listTufEvidence(db, {
      snapshotId,
      search: c.req.query('search') ?? '',
      limit,
      offset,
      actionableOnly,
    }))
    return c.json(result)
  } catch (error) {
    if (error instanceof TufEvidenceError) return c.json({ error: error.message }, error.status)
    throw error
  }
})

app.post('/api/admin/imports/tuf/proposals', requireRole('REFERENCE_MANAGER'), async (c) => {
  const user = c.get('user')!
  const body = await c.req.json<TufProposalBody>().catch((): TufProposalBody => ({}))
  const observationId = body.observationId?.trim() ?? ''
  if (!UUID_RE.test(observationId)) return c.json({ error: 'observationId must be a UUID' }, 400)

  try {
    const result = await withDb(c.env, (db) => createTufRerateProposal(db, {
      observationId,
      actorId: user.id,
      reason: body.reason ?? null,
    }))
    return c.json(result, 201)
  } catch (error) {
    if (error instanceof TufEvidenceError) return c.json({ error: error.message }, error.status)
    throw error
  }
})

app.get('/api/admin/imports/tuf/issues', requireRole('REFERENCE_MANAGER'), async (c) => {
  const snapshotId = c.req.query('snapshotId')?.trim()
  if (!snapshotId) return c.json({ error: 'snapshotId is required' }, 400)

  const issues = await withDb(c.env, async (db) => {
    const result = await db.query(
      `SELECT id,snapshot_id,source,severity,kind,external_id,
              linked_level_id,linked_level_version_id,details,created_at
       FROM import_issues
       WHERE source='TUF' AND snapshot_id=$1
       ORDER BY
         CASE severity WHEN 'ERROR' THEN 0 WHEN 'WARNING' THEN 1 ELSE 2 END,
         kind,external_id NULLS LAST,created_at`,
      [snapshotId],
    )
    return result.rows
  })

  return c.json({ issues })
})

app.get('/api/admin/imports/tuf/summary', requireRole('REFERENCE_MANAGER'), async (c) => {
  const snapshotId = c.req.query('snapshotId')?.trim()
  if (!snapshotId) return c.json({ error: 'snapshotId is required' }, 400)

  const summary = await withDb(c.env, async (db) => {
    const result = await db.query(
      `SELECT s.id,s.source,s.source_version,s.imported_at,
              (SELECT count(*)::int FROM external_level_observations x WHERE x.snapshot_id=s.id) AS levels,
              (SELECT count(*)::int FROM external_rating_observations x WHERE x.snapshot_id=s.id) AS ratings,
              (SELECT count(*)::int FROM external_reference_observations x WHERE x.snapshot_id=s.id) AS references,
              (SELECT count(*)::int FROM external_level_observations x WHERE x.snapshot_id=s.id AND x.linked_level_id IS NOT NULL) AS linked_levels,
              (SELECT count(*)::int FROM import_issues x WHERE x.snapshot_id=s.id AND x.severity='INFO') AS info_issues,
              (SELECT count(*)::int FROM import_issues x WHERE x.snapshot_id=s.id AND x.severity='WARNING') AS warning_issues,
              (SELECT count(*)::int FROM import_issues x WHERE x.snapshot_id=s.id AND x.severity='ERROR') AS error_issues
       FROM import_snapshots s
       WHERE s.id=$1 AND s.source='TUF'`,
      [snapshotId],
    )
    return result.rows[0] ?? null
  })

  if (!summary) return c.json({ error: 'TUF snapshot not found' }, 404)
  return c.json({ summary })
})

export default app