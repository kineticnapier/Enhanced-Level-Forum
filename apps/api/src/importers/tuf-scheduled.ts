import type { DbClient } from '../db'
import { withDb } from '../db'
import type { Env } from '../env'
import { audit } from '../services'
import { importTufSnapshot } from './tuf'

const TUF_API_BASE = 'https://api.tuforums.com/v2/database'
const PAGE_LIMIT = 100
const PAGES_PER_RUN = 5
const LEVEL_SORT = 'RECENT_ASC'
const SOURCE = 'TUF'
const ADVISORY_LOCK = 'elf:tuf:scheduled-crawl'

type JsonRecord = Record<string, unknown>

type CrawlState = {
  crawlId: string
  nextOffset: number
  observedTotal: number | null
}

type LevelPage = {
  results: unknown[]
  total: number
  hasMore: boolean
}

export type TufScheduledStepResult =
  | { status: 'PROGRESS'; crawlId: string; nextOffset: number; total: number; pagesFetched: number }
  | { status: 'DEFERRED'; crawlId: string; nextOffset: number; total: number | null; reason: string }
  | { status: 'RESET'; crawlId: string; reason: string }
  | { status: 'BUSY'; reason: string }
  | { status: 'IMPORTED'; snapshotId: string; levels: number; nextCrawlId: string }

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null
}

function sourceLevelId(value: unknown): string | null {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return String(value)
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    return value.trim().replace(/^0+(?=\d)/, '')
  }
  return null
}

async function fetchJson(url: URL): Promise<any> {
  const response = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!response.ok) {
    throw new Error(`TUF API ${response.status} ${response.statusText}: ${url.pathname}${url.search}`)
  }
  return response.json()
}

async function fetchLevelPage(offset: number): Promise<LevelPage> {
  const url = new URL(`${TUF_API_BASE}/levels`)
  url.searchParams.set('page', String(Math.floor(offset / PAGE_LIMIT) + 1))
  url.searchParams.set('offset', String(offset))
  url.searchParams.set('limit', String(PAGE_LIMIT))
  url.searchParams.set('deletedFilter', 'hide')
  url.searchParams.set('sort', LEVEL_SORT)

  const payload = await fetchJson(url)
  const results = Array.isArray(payload?.results) ? payload.results : []
  if (!Number.isInteger(payload?.total) || payload.total < 0) {
    throw new Error('TUF level page returned an invalid total')
  }
  if (payload?.hasMore && results.length !== PAGE_LIMIT) {
    throw new Error(`TUF level page returned ${results.length} rows while hasMore=true`)
  }
  return { results, total: payload.total, hasMore: !!payload?.hasMore }
}

async function ensureState(db: DbClient): Promise<CrawlState> {
  const result = await db.query(
    `INSERT INTO tuf_crawl_state(source)
     VALUES ($1)
     ON CONFLICT(source) DO UPDATE SET source=excluded.source
     RETURNING crawl_id,next_offset,observed_total`,
    [SOURCE],
  )
  const row = result.rows[0]
  return {
    crawlId: row.crawl_id,
    nextOffset: Number(row.next_offset),
    observedTotal: row.observed_total === null ? null : Number(row.observed_total),
  }
}

async function resetCrawl(db: DbClient, state: CrawlState): Promise<string> {
  await db.query(`DELETE FROM tuf_crawl_levels WHERE crawl_id=$1`, [state.crawlId])
  const result = await db.query(
    `UPDATE tuf_crawl_state
     SET crawl_id=gen_random_uuid(),next_offset=0,observed_total=NULL,started_at=now(),updated_at=now()
     WHERE source=$1
     RETURNING crawl_id`,
    [SOURCE],
  )
  return result.rows[0].crawl_id
}

async function updateState(db: DbClient, state: CrawlState) {
  await db.query(
    `UPDATE tuf_crawl_state
     SET next_offset=$2,observed_total=$3,updated_at=now()
     WHERE source=$1 AND crawl_id=$4`,
    [SOURCE, state.nextOffset, state.observedTotal, state.crawlId],
  )
}

async function storePage(db: DbClient, crawlId: string, offset: number, results: unknown[]) {
  if (!results.length) return
  const rows = results.map((rawData, index) => ({
    position: offset + index,
    external_id: sourceLevelId(record(rawData)?.id),
    raw_data: rawData,
  }))
  await db.query(
    `INSERT INTO tuf_crawl_levels(crawl_id,position,external_id,raw_data)
     SELECT $1,x.position,x.external_id,x.raw_data
     FROM jsonb_to_recordset($2::jsonb) AS x(position integer,external_id text,raw_data jsonb)
     ON CONFLICT(crawl_id,position) DO UPDATE
       SET external_id=excluded.external_id,raw_data=excluded.raw_data,fetched_at=now()`,
    [crawlId, JSON.stringify(rows)],
  )
}

function ids(values: unknown[]): Array<string | null> {
  return values.map((value) => sourceLevelId(record(value)?.id))
}

async function verifyOverlap(db: DbClient, state: CrawlState): Promise<string | null> {
  if (state.nextOffset === 0) return null
  const verifyOffset = Math.floor((state.nextOffset - 1) / PAGE_LIMIT) * PAGE_LIMIT
  const staged = await db.query(
    `SELECT external_id FROM tuf_crawl_levels
     WHERE crawl_id=$1 AND position >= $2 AND position < $3
     ORDER BY position`,
    [state.crawlId, verifyOffset, state.nextOffset],
  )
  if (!staged.rowCount) return 'staged overlap page is missing'

  const page = await fetchLevelPage(verifyOffset)
  if (state.observedTotal !== null && page.total < state.observedTotal) {
    return `TUF total decreased during crawl (${state.observedTotal} -> ${page.total})`
  }
  if (state.observedTotal === null || page.total > state.observedTotal) {
    state.observedTotal = page.total
    await updateState(db, state)
  }

  const current = ids(page.results.slice(0, staged.rowCount))
  const previous = staged.rows.map((row) => row.external_id as string | null)
  if (current.length !== previous.length || current.some((id, index) => id !== previous[index])) {
    return `TUF page boundary changed around offset ${verifyOffset}`
  }
  return null
}

async function finalizeCrawl(
  db: DbClient,
  state: CrawlState,
  metadata: Record<string, unknown>,
): Promise<TufScheduledStepResult> {
  const staged = await db.query(
    `SELECT raw_data FROM tuf_crawl_levels WHERE crawl_id=$1 ORDER BY position`,
    [state.crawlId],
  )
  if (state.observedTotal === null || staged.rowCount !== state.observedTotal) {
    const reason = `staged crawl is incomplete (${staged.rowCount}/${state.observedTotal ?? '?'})`
    const nextCrawlId = await resetCrawl(db, state)
    return { status: 'RESET', crawlId: nextCrawlId, reason }
  }

  let references: unknown
  try {
    references = await fetchJson(new URL(`${TUF_API_BASE}/references`))
  } catch (error) {
    return {
      status: 'DEFERRED',
      crawlId: state.crawlId,
      nextOffset: state.nextOffset,
      total: state.observedTotal,
      reason: error instanceof Error ? error.message : String(error),
    }
  }

  const result = await importTufSnapshot(db, {
    rawData: {
      levels: staged.rows.map((row) => row.raw_data),
      references,
      fetchedAt: new Date().toISOString(),
      apiBase: TUF_API_BASE,
      levelTotal: state.observedTotal,
    },
    actorId: null,
    sourceVersion: null,
  })

  try {
    await audit(db, null, 'TUF_SCHEDULED_IMPORT', 'import_snapshot', result.snapshot.id, {
      executionSource: 'SCHEDULED_INCREMENTAL',
      crawlId: state.crawlId,
      pagesPerRun: PAGES_PER_RUN,
      ...metadata,
      summary: result.summary,
    })
  } catch (error) {
    console.error('[TUF cron] failed to write scheduled audit marker', error)
  }

  const nextCrawlId = await resetCrawl(db, state)
  return {
    status: 'IMPORTED',
    snapshotId: result.snapshot.id,
    levels: result.summary.levels,
    nextCrawlId,
  }
}

async function runScheduledTufStepCore(
  env: Env,
  metadata: Record<string, unknown>,
): Promise<TufScheduledStepResult> {
  return withDb(env, async (db) => {
    const lock = await db.query(`SELECT pg_try_advisory_lock(hashtext($1)) AS locked`, [ADVISORY_LOCK])
    if (!lock.rows[0]?.locked) return { status: 'BUSY', reason: 'another scheduled TUF crawl step is still running' }

    try {
      const state = await ensureState(db)

      try {
        const overlapProblem = await verifyOverlap(db, state)
        if (overlapProblem) {
          const nextCrawlId = await resetCrawl(db, state)
          return { status: 'RESET', crawlId: nextCrawlId, reason: overlapProblem }
        }
      } catch (error) {
        return {
          status: 'DEFERRED',
          crawlId: state.crawlId,
          nextOffset: state.nextOffset,
          total: state.observedTotal,
          reason: error instanceof Error ? error.message : String(error),
        }
      }

      let pagesFetched = 0
      for (; pagesFetched < PAGES_PER_RUN; pagesFetched++) {
        let page: LevelPage
        try {
          page = await fetchLevelPage(state.nextOffset)
        } catch (error) {
          return {
            status: 'DEFERRED',
            crawlId: state.crawlId,
            nextOffset: state.nextOffset,
            total: state.observedTotal,
            reason: error instanceof Error ? error.message : String(error),
          }
        }

        if (state.observedTotal !== null && page.total < state.observedTotal) {
          const reason = `TUF total decreased during crawl (${state.observedTotal} -> ${page.total})`
          const nextCrawlId = await resetCrawl(db, state)
          return { status: 'RESET', crawlId: nextCrawlId, reason }
        }
        state.observedTotal = Math.max(state.observedTotal ?? 0, page.total)

        const offset = state.nextOffset
        await storePage(db, state.crawlId, offset, page.results)
        state.nextOffset += page.results.length
        await updateState(db, state)

        if (!page.hasMore || state.nextOffset >= state.observedTotal) {
          return finalizeCrawl(db, state, metadata)
        }
      }

      return {
        status: 'PROGRESS',
        crawlId: state.crawlId,
        nextOffset: state.nextOffset,
        total: state.observedTotal ?? state.nextOffset,
        pagesFetched,
      }
    } finally {
      await db.query(`SELECT pg_advisory_unlock(hashtext($1))`, [ADVISORY_LOCK]).catch(() => undefined)
    }
  })
}

function scheduledAt(metadata: Record<string, unknown>): string {
  const value = metadata.scheduledAt
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
    ? value
    : new Date().toISOString()
}

async function persistCronStatus(
  env: Env,
  metadata: Record<string, unknown>,
  result: TufScheduledStepResult | null,
  failureReason: string | null = null,
) {
  const status = result?.status ?? 'FAILED'
  const reason = failureReason ?? (result && 'reason' in result ? result.reason : null)
  const pagesFetched = result?.status === 'PROGRESS' ? result.pagesFetched : null
  const snapshotId = result?.status === 'IMPORTED' ? result.snapshotId : null

  await withDb(env, async (db) => {
    await db.query(
      `INSERT INTO tuf_crawl_state(
         source,last_run_at,last_status,last_reason,last_pages_fetched,last_snapshot_id,consecutive_deferred
       )
       VALUES ($1,$2::timestamptz,$3,$4,$5,$6,CASE WHEN $3='DEFERRED' THEN 1 ELSE 0 END)
       ON CONFLICT(source) DO UPDATE SET
         last_run_at=excluded.last_run_at,
         last_status=excluded.last_status,
         last_reason=excluded.last_reason,
         last_pages_fetched=excluded.last_pages_fetched,
         last_snapshot_id=coalesce(excluded.last_snapshot_id,tuf_crawl_state.last_snapshot_id),
         consecutive_deferred=CASE
           WHEN excluded.last_status='DEFERRED' THEN tuf_crawl_state.consecutive_deferred+1
           ELSE 0
         END`,
      [SOURCE, scheduledAt(metadata), status, reason, pagesFetched, snapshotId],
    )
  })
}

export async function runScheduledTufStep(
  env: Env,
  metadata: Record<string, unknown> = {},
): Promise<TufScheduledStepResult> {
  try {
    const result = await runScheduledTufStepCore(env, metadata)
    await persistCronStatus(env, metadata, result).catch((error) => {
      console.error('[TUF cron] failed to persist cron status', error)
    })
    return result
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    await persistCronStatus(env, metadata, null, reason).catch((statusError) => {
      console.error('[TUF cron] failed to persist failed cron status', statusError)
    })
    throw error
  }
}
