import type { DbClient } from '../db'
import { inTransaction, withDb } from '../db'
import type { Env } from '../env'
import { audit } from '../services'

const TUF_API_BASE = 'https://api.tuforums.com/v2/database'
const PAGE_LIMIT = 100
const PAGES_PER_RUN = 10
const FINALIZE_LEVELS_PER_RUN = 1000
const LEVEL_SORT = 'RECENT_ASC'
const SOURCE = 'TUF'
const ADVISORY_LOCK = 'elf:tuf:scheduled-crawl'

type JsonRecord = Record<string, any>
type Phase = 'CRAWL' | 'FINALIZE_LEVELS' | 'PUBLISH'
type Severity = 'INFO' | 'WARNING' | 'ERROR'

type CrawlState = {
  crawlId: string
  nextOffset: number
  observedTotal: number | null
  phase: Phase
  finalizeOffset: number
  referencesRaw: unknown
}

type LevelPage = {
  results: unknown[]
  total: number
  hasMore: boolean
}

type StagedIssue = {
  severity: Severity
  kind: string
  external_id: string | null
  linked_level_id: string | null
  linked_level_version_id: string | null
  details: unknown
}

export type TufScheduledStepResult =
  | { status: 'PROGRESS'; crawlId: string; nextOffset: number; total: number; pagesFetched: number }
  | { status: 'FINALIZING'; crawlId: string; phase: Phase; finalizeOffset: number; total: number; reason: string }
  | { status: 'DEFERRED'; crawlId: string; nextOffset: number; total: number | null; reason: string }
  | { status: 'RESET'; crawlId: string; reason: string }
  | { status: 'BUSY'; reason: string }
  | { status: 'IMPORTED'; snapshotId: string; levels: number; nextCrawlId: string }

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function sourceLevelId(value: unknown): string | null {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return String(value)
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return value.trim().replace(/^0+(?=\d)/, '')
  return null
}

function sha256(value: unknown): string | null {
  const valueText = text(value)?.toLowerCase()
  return valueText && /^[a-f0-9]{64}$/.test(valueText) ? valueText : null
}

function difficultyLabel(level: JsonRecord): string | null {
  const difficulty = record(level.difficulty)
  const rating = record(level.rating)
  return text(difficulty?.name)
    ?? text(difficulty?.displayName)
    ?? text(level.difficultyName)
    ?? text(level.diffName)
    ?? text(typeof level.difficulty === 'string' ? level.difficulty : null)
    ?? text(record(rating?.difficulty)?.name)
    ?? text(rating?.name)
    ?? text(level.pgu)
}

function pgu(label: string | null): { family: 'P' | 'G' | 'U'; tier: number } | null {
  if (!label) return null
  const match = /^([PGU])\s*(\d+)$/i.exec(label.trim())
  if (!match) return null
  const tier = Number(match[2])
  if (!Number.isInteger(tier) || tier < 1 || tier > 30) return null
  return { family: match[1]!.toUpperCase() as 'P' | 'G' | 'U', tier }
}

function levelSha(level: JsonRecord): string | null {
  return sha256(level.sha256) ?? sha256(level.sha) ?? sha256(level.fileSha256) ?? sha256(record(level.metadata)?.sha256)
}

function creatorName(level: JsonRecord): string | null {
  const charter = text(level.charter)
  if (charter) return charter
  if (Array.isArray(level.charters)) {
    const names = level.charters.map(text).filter((x): x is string => !!x)
    if (names.length) return names.join(', ')
  }
  if (Array.isArray(level.levelCredits)) {
    const names = level.levelCredits
      .map(record)
      .filter((x): x is JsonRecord => !!x && text(x.role)?.toLowerCase() === 'charter')
      .map((credit) => text(record(credit.creator)?.name))
      .filter((x): x is string => !!x)
    if (names.length) return names.join(', ')
  }
  return text(record(level.teamObject)?.name) ?? text(level.team)
}

function normalizeLevel(level: JsonRecord, id: string) {
  const song = text(record(level.songObject)?.name) ?? text(level.song) ?? `TUF #${id}`
  const suffix = text(level.suffix)
  const label = difficultyLabel(level)
  const parsed = pgu(label)
  return {
    external_id: id,
    sha256: levelSha(level),
    song,
    title: suffix ? `${song} ${suffix}` : song,
    creator: creatorName(level),
    download_url: text(level.dlLink) ?? text(level.legacyDllink) ?? text(level.workshopLink),
    difficulty_label: label,
    family: parsed?.family ?? null,
    tier: parsed?.tier ?? null,
    raw_data: level,
  }
}

async function fetchJson(url: URL): Promise<any> {
  const response = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!response.ok) throw new Error(`TUF API ${response.status} ${response.statusText}: ${url.pathname}${url.search}`)
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
  if (!Number.isInteger(payload?.total) || payload.total < 0) throw new Error('TUF level page returned an invalid total')
  if (payload?.hasMore && results.length !== PAGE_LIMIT) throw new Error(`TUF level page returned ${results.length} rows while hasMore=true`)
  return { results, total: payload.total, hasMore: !!payload?.hasMore }
}

async function ensureState(db: DbClient): Promise<CrawlState> {
  const result = await db.query(
    `INSERT INTO tuf_crawl_state(source)
     VALUES ($1)
     ON CONFLICT(source) DO UPDATE SET source=excluded.source
     RETURNING crawl_id,next_offset,observed_total,phase,finalize_offset,references_raw`,
    [SOURCE],
  )
  const row = result.rows[0]
  return {
    crawlId: row.crawl_id,
    nextOffset: Number(row.next_offset),
    observedTotal: row.observed_total === null ? null : Number(row.observed_total),
    phase: row.phase as Phase,
    finalizeOffset: Number(row.finalize_offset ?? 0),
    referencesRaw: row.references_raw ?? null,
  }
}

async function resetCrawl(db: DbClient, state: CrawlState): Promise<string> {
  await Promise.all([
    db.query(`DELETE FROM tuf_crawl_levels WHERE crawl_id=$1`, [state.crawlId]),
    db.query(`DELETE FROM tuf_finalize_levels WHERE crawl_id=$1`, [state.crawlId]),
    db.query(`DELETE FROM tuf_finalize_issues WHERE crawl_id=$1`, [state.crawlId]),
  ])
  const result = await db.query(
    `UPDATE tuf_crawl_state
     SET crawl_id=gen_random_uuid(),next_offset=0,observed_total=NULL,
         phase='CRAWL',finalize_offset=0,references_raw=NULL,finalize_started_at=NULL,
         started_at=now(),updated_at=now()
     WHERE source=$1
     RETURNING crawl_id`,
    [SOURCE],
  )
  return result.rows[0].crawl_id
}

async function updateCrawlState(db: DbClient, state: CrawlState) {
  await db.query(
    `UPDATE tuf_crawl_state
     SET next_offset=$2,observed_total=$3,phase=$4,finalize_offset=$5,references_raw=$6::jsonb,updated_at=now()
     WHERE source=$1 AND crawl_id=$7`,
    [SOURCE, state.nextOffset, state.observedTotal, state.phase, state.finalizeOffset,
      state.referencesRaw === null ? null : JSON.stringify(state.referencesRaw), state.crawlId],
  )
}

async function storePage(db: DbClient, crawlId: string, offset: number, results: unknown[]) {
  if (!results.length) return
  const rows = results.map((rawData, index) => ({ position: offset + index, external_id: sourceLevelId(record(rawData)?.id), raw_data: rawData }))
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
     WHERE crawl_id=$1 AND position >= $2 AND position < $3 ORDER BY position`,
    [state.crawlId, verifyOffset, state.nextOffset],
  )
  if (!staged.rowCount) return 'staged overlap page is missing'
  const page = await fetchLevelPage(verifyOffset)
  if (state.observedTotal !== null && page.total < state.observedTotal) return `TUF total decreased during crawl (${state.observedTotal} -> ${page.total})`
  if (state.observedTotal === null || page.total > state.observedTotal) {
    state.observedTotal = page.total
    await updateCrawlState(db, state)
  }
  const current = ids(page.results.slice(0, staged.rowCount))
  const previous = staged.rows.map((row) => row.external_id as string | null)
  if (current.length !== previous.length || current.some((id, index) => id !== previous[index])) return `TUF page boundary changed around offset ${verifyOffset}`
  return null
}

async function beginFinalize(db: DbClient, state: CrawlState): Promise<TufScheduledStepResult> {
  if (state.observedTotal === null) {
    const nextCrawlId = await resetCrawl(db, state)
    return { status: 'RESET', crawlId: nextCrawlId, reason: 'cannot finalize a crawl without an observed total' }
  }
  const count = await db.query(`SELECT count(*)::int AS count FROM tuf_crawl_levels WHERE crawl_id=$1`, [state.crawlId])
  if (Number(count.rows[0]?.count ?? 0) !== state.observedTotal) {
    const reason = `staged crawl is incomplete (${count.rows[0]?.count ?? 0}/${state.observedTotal})`
    const nextCrawlId = await resetCrawl(db, state)
    return { status: 'RESET', crawlId: nextCrawlId, reason }
  }
  try {
    state.referencesRaw = await fetchJson(new URL(`${TUF_API_BASE}/references`))
  } catch (error) {
    return { status: 'DEFERRED', crawlId: state.crawlId, nextOffset: state.nextOffset, total: state.observedTotal, reason: error instanceof Error ? error.message : String(error) }
  }
  state.phase = 'FINALIZE_LEVELS'
  state.finalizeOffset = 0
  await db.query(
    `UPDATE tuf_crawl_state SET phase='FINALIZE_LEVELS',finalize_offset=0,references_raw=$2::jsonb,finalize_started_at=now(),updated_at=now()
     WHERE source=$1 AND crawl_id=$3`,
    [SOURCE, JSON.stringify(state.referencesRaw), state.crawlId],
  )
  return { status: 'FINALIZING', crawlId: state.crawlId, phase: state.phase, finalizeOffset: 0, total: state.observedTotal, reason: 'level crawl complete; starting chunked finalization' }
}

async function stageIssues(db: DbClient, crawlId: string, issues: StagedIssue[]) {
  if (!issues.length) return
  await db.query(
    `INSERT INTO tuf_finalize_issues(crawl_id,severity,kind,external_id,linked_level_id,linked_level_version_id,details)
     SELECT $1,x.severity,x.kind,x.external_id,x.linked_level_id,x.linked_level_version_id,x.details
     FROM jsonb_to_recordset($2::jsonb) AS x(
       severity text,kind text,external_id text,linked_level_id uuid,linked_level_version_id uuid,details jsonb
     )`,
    [crawlId, JSON.stringify(issues)],
  )
}

async function finalizeLevelChunk(db: DbClient, state: CrawlState): Promise<TufScheduledStepResult> {
  const total = state.observedTotal ?? state.nextOffset
  const end = Math.min(total, state.finalizeOffset + FINALIZE_LEVELS_PER_RUN)
  const raw = await db.query(
    `SELECT position,raw_data FROM tuf_crawl_levels
     WHERE crawl_id=$1 AND position >= $2 AND position < $3 ORDER BY position`,
    [state.crawlId, state.finalizeOffset, end],
  )
  if (!raw.rowCount && state.finalizeOffset < total) throw new Error(`finalize chunk ${state.finalizeOffset}-${end} is missing`)

  const issues: StagedIssue[] = []
  const normalized = raw.rows.flatMap((row) => {
    const level = record(row.raw_data)
    const id = level ? sourceLevelId(level.id) : null
    if (!level || !id) {
      issues.push({ severity: 'ERROR', kind: 'INVALID_LEVEL_ID', external_id: null, linked_level_id: null, linked_level_version_id: null, details: { position: row.position } })
      return []
    }
    return [normalizeLevel(level, id)]
  })

  const externalIds = [...new Set(normalized.map((x) => x.external_id))]
  const shas = [...new Set(normalized.map((x) => x.sha256).filter((x): x is string => !!x))]
  const [mapped, shaMapped] = await Promise.all([
    externalIds.length
      ? db.query(`SELECT external_id,level_id FROM external_level_ids WHERE source='TUF' AND external_id=ANY($1::text[])`, [externalIds])
      : Promise.resolve({ rows: [] as any[] }),
    shas.length
      ? db.query(`SELECT lower(sha256) AS sha256,level_id,id AS level_version_id FROM level_versions WHERE sha256 IS NOT NULL AND lower(sha256)=ANY($1::text[])`, [shas])
      : Promise.resolve({ rows: [] as any[] }),
  ])
  const links = new Map<string, { levelId: string; levelVersionId: string | null }>()
  for (const row of mapped.rows) links.set(String(row.external_id), { levelId: row.level_id, levelVersionId: null })
  const shaLinks = new Map<string, { levelId: string; levelVersionId: string }>()
  for (const row of shaMapped.rows) shaLinks.set(String(row.sha256), { levelId: row.level_id, levelVersionId: row.level_version_id })

  const autoLinks: Array<{ level_id: string; external_id: string }> = []
  for (const item of normalized) {
    const current = links.get(item.external_id)
    const bySha = item.sha256 ? shaLinks.get(item.sha256) : undefined
    if (current && bySha && current.levelId !== bySha.levelId) {
      issues.push({ severity: 'ERROR', kind: 'EXTERNAL_ID_SHA_MAPPING_CONFLICT', external_id: item.external_id, linked_level_id: current.levelId, linked_level_version_id: null, details: { sha256: item.sha256, shaMatchedLevelId: bySha.levelId } })
    } else if (!current && bySha) {
      autoLinks.push({ level_id: bySha.levelId, external_id: item.external_id })
      links.set(item.external_id, { levelId: bySha.levelId, levelVersionId: bySha.levelVersionId })
    } else if (current && bySha && current.levelId === bySha.levelId) {
      links.set(item.external_id, { levelId: current.levelId, levelVersionId: bySha.levelVersionId })
    }
  }
  if (autoLinks.length) {
    await db.query(
      `INSERT INTO external_level_ids(level_id,source,external_id)
       SELECT x.level_id,'TUF',x.external_id FROM jsonb_to_recordset($1::jsonb) AS x(level_id uuid,external_id text)
       ON CONFLICT(source,external_id) DO NOTHING`,
      [JSON.stringify(autoLinks)],
    )
  }

  const rows = normalized.map((item) => {
    const link = links.get(item.external_id)
    if (!item.difficulty_label) issues.push({ severity: 'WARNING', kind: 'MISSING_DIFFICULTY', external_id: item.external_id, linked_level_id: link?.levelId ?? null, linked_level_version_id: link?.levelVersionId ?? null, details: {} })
    return { ...item, linked_level_id: link?.levelId ?? null, linked_level_version_id: link?.levelVersionId ?? null }
  })
  if (rows.length) {
    await db.query(
      `INSERT INTO tuf_finalize_levels(
         crawl_id,external_id,linked_level_id,linked_level_version_id,sha256,song,title,creator,download_url,difficulty_label,family,tier,raw_data
       )
       SELECT $1,x.external_id,x.linked_level_id,x.linked_level_version_id,x.sha256,x.song,x.title,x.creator,x.download_url,x.difficulty_label,x.family,x.tier,x.raw_data
       FROM jsonb_to_recordset($2::jsonb) AS x(
         external_id text,linked_level_id uuid,linked_level_version_id uuid,sha256 text,song text,title text,creator text,download_url text,
         difficulty_label text,family text,tier integer,raw_data jsonb
       )
       ON CONFLICT(crawl_id,external_id) DO UPDATE SET
         linked_level_id=excluded.linked_level_id,linked_level_version_id=excluded.linked_level_version_id,sha256=excluded.sha256,
         song=excluded.song,title=excluded.title,creator=excluded.creator,download_url=excluded.download_url,
         difficulty_label=excluded.difficulty_label,family=excluded.family,tier=excluded.tier,raw_data=excluded.raw_data`,
      [state.crawlId, JSON.stringify(rows)],
    )
  }
  await stageIssues(db, state.crawlId, issues)

  state.finalizeOffset = end
  if (end >= total) state.phase = 'PUBLISH'
  await updateCrawlState(db, state)
  return {
    status: 'FINALIZING', crawlId: state.crawlId, phase: state.phase, finalizeOffset: state.finalizeOffset, total,
    reason: state.phase === 'PUBLISH' ? 'all level chunks normalized; snapshot publish is next' : `normalized ${state.finalizeOffset}/${total} levels`,
  }
}

function buildReferenceRows(references: unknown, links: Map<string, { levelId: string | null; levelVersionId: string | null }>) {
  if (!Array.isArray(references)) throw new Error('TUF references must be an array')
  const rows: JsonRecord[] = []
  const issues: StagedIssue[] = []
  const keys = new Set<string>()
  for (const groupValue of references) {
    const group = record(groupValue)
    if (!group) { issues.push({ severity: 'ERROR', kind: 'INVALID_REFERENCE_GROUP', external_id: null, linked_level_id: null, linked_level_version_id: null, details: {} }); continue }
    const label = text(record(group.difficulty)?.name) ?? text(group.difficulty)
    const parsed = pgu(label)
    const levels = Array.isArray(group.levels) ? group.levels : []
    if (!Array.isArray(group.levels)) issues.push({ severity: 'ERROR', kind: 'INVALID_REFERENCE_LEVELS', external_id: null, linked_level_id: null, linked_level_version_id: null, details: { difficulty: label } })
    for (const levelValue of levels) {
      const level = record(levelValue)
      const id = level ? sourceLevelId(level.id) : null
      if (!level || !id) { issues.push({ severity: 'ERROR', kind: 'INVALID_REFERENCE_LEVEL_ID', external_id: null, linked_level_id: null, linked_level_version_id: null, details: { difficulty: label } }); continue }
      const referenceType = text(level.type)?.toUpperCase() ?? 'UNKNOWN'
      const key = `${id}|${label ?? ''}|${referenceType}`
      const link = links.get(id)
      if (keys.has(key)) { issues.push({ severity: 'WARNING', kind: 'DUPLICATE_REFERENCE', external_id: id, linked_level_id: link?.levelId ?? null, linked_level_version_id: link?.levelVersionId ?? null, details: { difficulty: label, referenceType } }); continue }
      keys.add(key)
      if (!label || !parsed) issues.push({ severity: 'WARNING', kind: 'INVALID_REFERENCE_DIFFICULTY', external_id: id, linked_level_id: link?.levelId ?? null, linked_level_version_id: link?.levelVersionId ?? null, details: { difficulty: label, referenceType } })
      if (referenceType === 'UNKNOWN') issues.push({ severity: 'INFO', kind: 'MISSING_REFERENCE_TYPE', external_id: id, linked_level_id: link?.levelId ?? null, linked_level_version_id: link?.levelVersionId ?? null, details: { difficulty: label } })
      rows.push({ external_id: id, linked_level_id: link?.levelId ?? null, linked_level_version_id: link?.levelVersionId ?? null, family: parsed?.family ?? null, tier: parsed?.tier ?? null, difficulty_label: label, reference_type: referenceType, raw_data: level })
    }
  }
  return { rows, issues }
}

async function publishSnapshot(db: DbClient, state: CrawlState, metadata: Record<string, unknown>): Promise<TufScheduledStepResult> {
  if (state.observedTotal === null || !Array.isArray(state.referencesRaw)) throw new Error('finalize state is incomplete')
  const observedTotal = state.observedTotal
  const referencesRaw = state.referencesRaw
  return inTransaction(db, async () => {
    const staged = await db.query(`SELECT count(*)::int AS count FROM tuf_finalize_levels WHERE crawl_id=$1`, [state.crawlId])
    const stagedCount = Number(staged.rows[0]?.count ?? 0)
    if (stagedCount > observedTotal) throw new Error(`finalized level count exceeds crawl total (${stagedCount}/${observedTotal})`)

    const sourceVersion = `v2@${new Date().toISOString()}`
    const snapshotResult = await db.query(
      `INSERT INTO import_snapshots(source,source_version,raw_data,imported_by)
       VALUES ('TUF',$1,$2::jsonb,NULL) RETURNING id,source,source_version,imported_at`,
      [sourceVersion, JSON.stringify({ kind: 'scheduled-incremental', crawlId: state.crawlId, apiBase: TUF_API_BASE, levelTotal: observedTotal })],
    )
    const snapshot = snapshotResult.rows[0]

    await db.query(
      `INSERT INTO external_level_observations(
         snapshot_id,source,external_id,linked_level_id,linked_level_version_id,sha256,song,title,creator,download_url,difficulty_label,raw_data
       )
       SELECT $2,'TUF',external_id,linked_level_id,linked_level_version_id,sha256,song,title,creator,download_url,difficulty_label,raw_data
       FROM tuf_finalize_levels WHERE crawl_id=$1`,
      [state.crawlId, snapshot.id],
    )
    await db.query(
      `INSERT INTO external_rating_observations(level_id,level_version_id,snapshot_id,source,external_id,family,tier,label,raw_data)
       SELECT linked_level_id,linked_level_version_id,$2,'TUF',external_id,family,tier,difficulty_label,raw_data
       FROM tuf_finalize_levels WHERE crawl_id=$1 AND difficulty_label IS NOT NULL`,
      [state.crawlId, snapshot.id],
    )

    const refIds = new Set<string>()
    for (const groupValue of referencesRaw) {
      const group = record(groupValue)
      if (!group || !Array.isArray(group.levels)) continue
      for (const value of group.levels) {
        const id = sourceLevelId(record(value)?.id)
        if (id) refIds.add(id)
      }
    }
    const linkRows = refIds.size
      ? await db.query(`SELECT external_id,linked_level_id,linked_level_version_id FROM tuf_finalize_levels WHERE crawl_id=$1 AND external_id=ANY($2::text[])`, [state.crawlId, [...refIds]])
      : { rows: [] as any[] }
    const links = new Map<string, { levelId: string | null; levelVersionId: string | null }>()
    for (const row of linkRows.rows) links.set(String(row.external_id), { levelId: row.linked_level_id ?? null, levelVersionId: row.linked_level_version_id ?? null })
    const refs = buildReferenceRows(referencesRaw, links)
    if (refs.rows.length) {
      await db.query(
        `INSERT INTO external_reference_observations(snapshot_id,source,external_id,linked_level_id,linked_level_version_id,family,tier,difficulty_label,reference_type,raw_data)
         SELECT $1,'TUF',x.external_id,x.linked_level_id,x.linked_level_version_id,x.family,x.tier,x.difficulty_label,x.reference_type,x.raw_data
         FROM jsonb_to_recordset($2::jsonb) AS x(
           external_id text,linked_level_id uuid,linked_level_version_id uuid,family text,tier integer,difficulty_label text,reference_type text,raw_data jsonb
         )`,
        [snapshot.id, JSON.stringify(refs.rows)],
      )
    }

    await db.query(
      `INSERT INTO import_issues(snapshot_id,source,severity,kind,external_id,linked_level_id,linked_level_version_id,details)
       SELECT $2,'TUF',severity,kind,external_id,linked_level_id,linked_level_version_id,details
       FROM tuf_finalize_issues WHERE crawl_id=$1`,
      [state.crawlId, snapshot.id],
    )
    if (refs.issues.length) {
      await db.query(
        `INSERT INTO import_issues(snapshot_id,source,severity,kind,external_id,linked_level_id,linked_level_version_id,details)
         SELECT $1,'TUF',x.severity,x.kind,x.external_id,x.linked_level_id,x.linked_level_version_id,x.details
         FROM jsonb_to_recordset($2::jsonb) AS x(severity text,kind text,external_id text,linked_level_id uuid,linked_level_version_id uuid,details jsonb)`,
        [snapshot.id, JSON.stringify(refs.issues)],
      )
    }
    await db.query(
      `INSERT INTO import_issues(snapshot_id,source,severity,kind,external_id,linked_level_id,linked_level_version_id,details)
       SELECT $2,'TUF','ERROR','SHA_RATING_CONFLICT',NULL,min(linked_level_id),min(linked_level_version_id),
              jsonb_build_object('sha256',sha256,'difficulties',jsonb_agg(DISTINCT difficulty_label))
       FROM tuf_finalize_levels
       WHERE crawl_id=$1 AND sha256 IS NOT NULL AND difficulty_label IS NOT NULL
       GROUP BY sha256 HAVING count(DISTINCT difficulty_label) > 1`,
      [state.crawlId, snapshot.id],
    )

    const counts = await db.query(
      `SELECT
         (SELECT count(*)::int FROM external_level_observations WHERE snapshot_id=$1) AS levels,
         (SELECT count(*)::int FROM external_rating_observations WHERE snapshot_id=$1) AS ratings,
         (SELECT count(*)::int FROM external_reference_observations WHERE snapshot_id=$1) AS refs,
         (SELECT count(*)::int FROM external_level_observations WHERE snapshot_id=$1 AND linked_level_id IS NOT NULL) AS linked`,
      [snapshot.id],
    )
    const summary = {
      levels: Number(counts.rows[0]?.levels ?? 0),
      ratingObservations: Number(counts.rows[0]?.ratings ?? 0),
      referenceObservations: Number(counts.rows[0]?.refs ?? 0),
      linkedLevels: Number(counts.rows[0]?.linked ?? 0),
    }
    await audit(db, null, 'TUF_IMPORT', 'import_snapshot', snapshot.id, summary)
    await audit(db, null, 'TUF_SCHEDULED_IMPORT', 'import_snapshot', snapshot.id, {
      executionSource: 'SCHEDULED_INCREMENTAL_CHUNKED_FINALIZE', crawlId: state.crawlId,
      pagesPerRun: PAGES_PER_RUN, finalizeLevelsPerRun: FINALIZE_LEVELS_PER_RUN, ...metadata, summary,
    })

    const nextCrawlId = await resetCrawl(db, state)
    return { status: 'IMPORTED', snapshotId: snapshot.id, levels: summary.levels, nextCrawlId }
  })
}

async function runScheduledTufStepCore(env: Env, metadata: Record<string, unknown>): Promise<TufScheduledStepResult> {
  return withDb(env, async (db) => {
    const lock = await db.query(`SELECT pg_try_advisory_lock(hashtext($1)) AS locked`, [ADVISORY_LOCK])
    if (!lock.rows[0]?.locked) return { status: 'BUSY', reason: 'another scheduled TUF crawl step is still running' }
    try {
      const state = await ensureState(db)

      if (state.phase === 'FINALIZE_LEVELS') return finalizeLevelChunk(db, state)
      if (state.phase === 'PUBLISH') return publishSnapshot(db, state, metadata)
      if (state.observedTotal !== null && state.nextOffset >= state.observedTotal) return beginFinalize(db, state)

      try {
        const overlapProblem = await verifyOverlap(db, state)
        if (overlapProblem) {
          const nextCrawlId = await resetCrawl(db, state)
          return { status: 'RESET', crawlId: nextCrawlId, reason: overlapProblem }
        }
      } catch (error) {
        return { status: 'DEFERRED', crawlId: state.crawlId, nextOffset: state.nextOffset, total: state.observedTotal, reason: error instanceof Error ? error.message : String(error) }
      }

      let pagesFetched = 0
      for (; pagesFetched < PAGES_PER_RUN; pagesFetched++) {
        let page: LevelPage
        try { page = await fetchLevelPage(state.nextOffset) }
        catch (error) { return { status: 'DEFERRED', crawlId: state.crawlId, nextOffset: state.nextOffset, total: state.observedTotal, reason: error instanceof Error ? error.message : String(error) } }

        if (state.observedTotal !== null && page.total < state.observedTotal) {
          const reason = `TUF total decreased during crawl (${state.observedTotal} -> ${page.total})`
          const nextCrawlId = await resetCrawl(db, state)
          return { status: 'RESET', crawlId: nextCrawlId, reason }
        }
        state.observedTotal = Math.max(state.observedTotal ?? 0, page.total)
        const offset = state.nextOffset
        await storePage(db, state.crawlId, offset, page.results)
        state.nextOffset += page.results.length
        await updateCrawlState(db, state)
        if (!page.hasMore || state.nextOffset >= state.observedTotal) return beginFinalize(db, state)
      }
      return { status: 'PROGRESS', crawlId: state.crawlId, nextOffset: state.nextOffset, total: state.observedTotal ?? state.nextOffset, pagesFetched }
    } finally {
      await db.query(`SELECT pg_advisory_unlock(hashtext($1))`, [ADVISORY_LOCK]).catch(() => undefined)
    }
  })
}

function scheduledAt(metadata: Record<string, unknown>): string {
  const value = metadata.scheduledAt
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : new Date().toISOString()
}

async function persistCronStatus(env: Env, metadata: Record<string, unknown>, result: TufScheduledStepResult | null, failureReason: string | null = null) {
  const status = result?.status ?? 'FAILED'
  const reason = failureReason ?? (result && 'reason' in result ? result.reason : null)
  const pagesFetched = result?.status === 'PROGRESS' ? result.pagesFetched : null
  const snapshotId = result?.status === 'IMPORTED' ? result.snapshotId : null
  await withDb(env, async (db) => {
    await db.query(
      `INSERT INTO tuf_crawl_state(source,last_run_at,last_status,last_reason,last_pages_fetched,last_snapshot_id,consecutive_deferred)
       VALUES ($1,$2::timestamptz,$3,$4,$5,$6,CASE WHEN $3='DEFERRED' THEN 1 ELSE 0 END)
       ON CONFLICT(source) DO UPDATE SET
         last_run_at=excluded.last_run_at,last_status=excluded.last_status,last_reason=excluded.last_reason,
         last_pages_fetched=excluded.last_pages_fetched,last_snapshot_id=coalesce(excluded.last_snapshot_id,tuf_crawl_state.last_snapshot_id),
         consecutive_deferred=CASE WHEN excluded.last_status='DEFERRED' THEN tuf_crawl_state.consecutive_deferred+1 ELSE 0 END`,
      [SOURCE, scheduledAt(metadata), status, reason, pagesFetched, snapshotId],
    )
  })
}

export async function runScheduledTufStep(env: Env, metadata: Record<string, unknown> = {}): Promise<TufScheduledStepResult> {
  try {
    const result = await runScheduledTufStepCore(env, metadata)
    await persistCronStatus(env, metadata, result).catch((error) => console.error('[TUF cron] failed to persist cron status', error))
    return result
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    await persistCronStatus(env, metadata, null, reason).catch((statusError) => console.error('[TUF cron] failed to persist failed cron status', statusError))
    throw error
  }
}
