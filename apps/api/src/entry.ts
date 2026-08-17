import { Hono } from 'hono'
import coreApp from './index'
import { requireRole, type AppBindings } from './auth'
import { withDb } from './db'
import { createTufRerateProposal, listTufEvidence, TufEvidenceError } from './evidence/tuf'
import { importTufSnapshot, type TufRawSnapshot } from './importers/tuf'
import { fetchConsistentTufSnapshot } from './importers/tuf-fetch'
import { registerLevelMetadataCatalogRoutes, registerLevelMetadataRoutes } from './level-metadata'
import { registerLevelVariantRoutes } from './level-variants'
import { registerProductionAuth } from './production-auth'
import { registerPublicRoutes } from './public'
import { registerRatingQueueRoutes } from './rating-queue'
import { createLevelFromTufObservation, linkTufObservation, listTufUnlinked, TufReconciliationError } from './reconciliation/tuf'
import { registerSubmissionRoutes } from './submissions'
import { registerTufCronStatusRoutes } from './tuf-cron-status'

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
// practical Level metadata compatibility layer, Variant hierarchy, and
// queue-aware rating routes are next so old Level -> Version clients keep
// working while new clients can use Level -> Variant -> Version.
const app = new Hono<AppBindings>()
registerProductionAuth(app)
registerSubmissionRoutes(app)
registerLevelVariantRoutes(app)
registerLevelMetadataRoutes(app)
registerRatingQueueRoutes(app)
registerTufCronStatusRoutes(app)
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
  const search = c.req.query('search')?.trim() || ''
  const limit = Number(c.req.query('limit') || 100)
  const offset = Number(c.req.query('offset') || 0)
  const result = await withDb(c.env, (db) => listTufUnlinked(db, { snapshotId, search, limit, offset }))
  return c.json(result)
})

app.post('/api/admin/imports/tuf/link', requireRole('REFERENCE_MANAGER'), async (c) => {
  const user = c.get('user')!
  const body = await c.req.json<TufLinkBody>().catch((): TufLinkBody => ({}))
  const observationId = body.observationId?.trim() || ''
  const levelId = body.levelId?.trim() || ''
  const levelVersionId = body.levelVersionId?.trim() || null
  if (!UUID_RE.test(observationId)) return c.json({ error: 'Invalid observationId' }, 400)
  if (!UUID_RE.test(levelId)) return c.json({ error: 'Invalid levelId' }, 400)
  if (levelVersionId && !UUID_RE.test(levelVersionId)) return c.json({ error: 'Invalid levelVersionId' }, 400)
  try {
    const result = await withDb(c.env, (db) => linkTufObservation(db, { observationId, levelId, levelVersionId, actorId: user.id }))
    return c.json(result)
  } catch (error) {
    if (error instanceof TufReconciliationError) return c.json({ error: error.message }, error.status)
    throw error
  }
})

app.post('/api/admin/imports/tuf/create-level', requireRole('MODERATOR'), async (c) => {
  const user = c.get('user')!
  const body = await c.req.json<TufCreateLevelBody>().catch((): TufCreateLevelBody => ({}))
  const observationId = body.observationId?.trim() || ''
  if (!UUID_RE.test(observationId)) return c.json({ error: 'Invalid observationId' }, 400)
  try {
    const result = await withDb(c.env, (db) => createLevelFromTufObservation(db, {
      observationId,
      actorId: user.id,
      song: body.song,
      title: body.title,
      creator: body.creator,
      status: body.status,
      version: body.version,
    }))
    return c.json(result, 201)
  } catch (error) {
    if (error instanceof TufReconciliationError) return c.json({ error: error.message }, error.status)
    throw error
  }
})

app.get('/api/admin/evidence/tuf', requireRole('REFERENCE_MANAGER'), async (c) => {
  const snapshotId = c.req.query('snapshotId')?.trim() || null
  if (snapshotId && !UUID_RE.test(snapshotId)) return c.json({ error: 'Invalid snapshotId' }, 400)
  const search = c.req.query('search')?.trim() || ''
  const actionableOnly = c.req.query('actionableOnly') === 'true'
  const limit = Number(c.req.query('limit') || 100)
  const offset = Number(c.req.query('offset') || 0)
  const result = await withDb(c.env, (db) => listTufEvidence(db, { snapshotId, search, actionableOnly, limit, offset }))
  return c.json(result)
})

app.post('/api/admin/evidence/tuf/proposals', requireRole('REFERENCE_MANAGER'), async (c) => {
  const user = c.get('user')!
  const body = await c.req.json<TufProposalBody>().catch((): TufProposalBody => ({}))
  const observationId = body.observationId?.trim() || ''
  if (!UUID_RE.test(observationId)) return c.json({ error: 'Invalid observationId' }, 400)
  try {
    const result = await withDb(c.env, (db) => createTufRerateProposal(db, {
      observationId,
      proposerId: user.id,
      reason: body.reason,
    }))
    return c.json(result, 201)
  } catch (error) {
    if (error instanceof TufEvidenceError) return c.json({ error: error.message }, error.status)
    throw error
  }
})

export default app
