import type { Hono } from 'hono'
import { loadUser, requireRole, type AppBindings } from './auth'
import { withDb, type DbClient } from './db'

const SOURCE = 'TUF'
const CRON_SCHEDULE = '*/30 * * * *'

function pgCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? code : null
}

function nextCronTick(now = new Date()): string {
  const next = new Date(now)
  next.setUTCSeconds(0, 0)
  if (next.getUTCMinutes() < 30) next.setUTCMinutes(30)
  else {
    next.setUTCMinutes(0)
    next.setUTCHours(next.getUTCHours() + 1)
  }
  return next.toISOString()
}

async function readState(db: DbClient) {
  try {
    const result = await db.query(
      `SELECT source,crawl_id,next_offset,observed_total,started_at,updated_at,
              last_run_at,last_status,last_reason,last_pages_fetched,last_snapshot_id,consecutive_deferred
       FROM tuf_crawl_state WHERE source=$1`,
      [SOURCE],
    )
    return { trackingAvailable: true, row: result.rows[0] ?? null }
  } catch (error) {
    if (pgCode(error) !== '42703') throw error
    const result = await db.query(
      `SELECT source,crawl_id,next_offset,observed_total,started_at,updated_at
       FROM tuf_crawl_state WHERE source=$1`,
      [SOURCE],
    )
    return { trackingAvailable: false, row: result.rows[0] ?? null }
  }
}

function healthOf(state: any, trackingAvailable: boolean, now = Date.now()) {
  if (!trackingAvailable) return 'MIGRATION_REQUIRED'
  if (!state?.last_run_at) return 'UNKNOWN'
  const lastRun = Date.parse(state.last_run_at)
  if (!Number.isFinite(lastRun) || now - lastRun > 75 * 60 * 1000) return 'STALE'
  if (state.last_status === 'FAILED' || Number(state.consecutive_deferred ?? 0) >= 3) return 'DEGRADED'
  if (['DEFERRED','RESET','BUSY'].includes(state.last_status)) return 'WARNING'
  return 'HEALTHY'
}

export function registerTufCronStatusRoutes(app: Hono<AppBindings>) {
  app.get('/api/admin/imports/tuf/cron-status', loadUser, requireRole('REFERENCE_MANAGER'), async (c) => {
    const status = await withDb(c.env, async (db) => {
      const stateResult = await readState(db)
      const state = stateResult.row
      const [staged, latest] = await Promise.all([
        state
          ? db.query(
              `SELECT count(*)::int AS count FROM tuf_crawl_levels WHERE crawl_id=$1`,
              [state.crawl_id],
            )
          : Promise.resolve({ rows: [{ count: 0 }] }),
        db.query(
          `SELECT s.id,s.imported_at,
                  (SELECT count(*)::int FROM external_level_observations x WHERE x.snapshot_id=s.id) AS levels,
                  (SELECT count(*)::int FROM external_rating_observations x WHERE x.snapshot_id=s.id) AS ratings,
                  (SELECT count(*)::int FROM external_reference_observations x WHERE x.snapshot_id=s.id) AS references
           FROM import_snapshots s
           WHERE s.source=$1
           ORDER BY s.imported_at DESC
           LIMIT 1`,
          [SOURCE],
        ),
      ])

      const nextOffset = state ? Number(state.next_offset ?? 0) : 0
      const observedTotal = state?.observed_total === null || state?.observed_total === undefined
        ? null
        : Number(state.observed_total)
      const stagedLevels = Number(staged.rows[0]?.count ?? 0)
      const progress = observedTotal && observedTotal > 0
        ? Math.min(1, nextOffset / observedTotal)
        : null

      return {
        source: SOURCE,
        schedule: CRON_SCHEDULE,
        nextScheduledAt: nextCronTick(),
        trackingAvailable: stateResult.trackingAvailable,
        health: healthOf(state, stateResult.trackingAvailable),
        crawl: state ? {
          crawlId: state.crawl_id,
          nextOffset,
          observedTotal,
          stagedLevels,
          progress,
          startedAt: state.started_at,
          updatedAt: state.updated_at,
        } : null,
        lastRun: state?.last_run_at ? {
          at: state.last_run_at,
          status: state.last_status ?? null,
          reason: state.last_reason ?? null,
          pagesFetched: state.last_pages_fetched === null || state.last_pages_fetched === undefined
            ? null
            : Number(state.last_pages_fetched),
          consecutiveDeferred: Number(state.consecutive_deferred ?? 0),
          snapshotId: state.last_snapshot_id ?? null,
        } : null,
        latestSnapshot: latest.rows[0] ? {
          id: latest.rows[0].id,
          importedAt: latest.rows[0].imported_at,
          levels: Number(latest.rows[0].levels ?? 0),
          ratings: Number(latest.rows[0].ratings ?? 0),
          references: Number(latest.rows[0].references ?? 0),
        } : null,
      }
    })

    return c.json({ status })
  })
}
