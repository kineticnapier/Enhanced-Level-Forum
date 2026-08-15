import type { DbClient } from '../db'
import { inTransaction } from '../db'
import { audit } from '../services'

const SOURCE = 'TUF'
const DEFAULT_API_BASE = 'https://api.tuforums.com/v2/database'
const PAGE_LIMIT = 100
const INSERT_BATCH = 250

type JsonRecord = Record<string, any>
type Severity = 'INFO' | 'WARNING' | 'ERROR'

type Link = {
  levelId: string
  levelVersionId: string | null
}

type ImportIssue = {
  severity: Severity
  kind: string
  externalId: string | null
  linkedLevelId: string | null
  linkedLevelVersionId: string | null
  details: unknown
}

export type TufRawSnapshot = {
  levels: unknown[]
  references: unknown
  fetchedAt?: string
  apiBase?: string
  levelTotal?: number
}

export type TufImportResult = {
  snapshot: {
    id: string
    source: string
    sourceVersion: string | null
    importedAt: string
  }
  summary: {
    levels: number
    ratingObservations: number
    referenceObservations: number
    linkedLevels: number
    autoLinkedBySha: number
    issues: Record<Severity, number>
  }
}

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function externalId(value: unknown): string | null {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return String(value)
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return String(Number(value.trim()))
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
  return sha256(level.sha256)
    ?? sha256(level.sha)
    ?? sha256(level.fileSha256)
    ?? sha256(record(level.metadata)?.sha256)
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

function normalizedLevel(level: JsonRecord, id: string) {
  const song = text(record(level.songObject)?.name) ?? text(level.song) ?? `TUF #${id}`
  const suffix = text(level.suffix)
  return {
    externalId: id,
    sha256: levelSha(level),
    song,
    title: suffix ? `${song} ${suffix}` : song,
    creator: creatorName(level),
    downloadUrl: text(level.dlLink) ?? text(level.legacyDllink) ?? text(level.workshopLink),
    difficultyLabel: difficultyLabel(level),
    rawData: level,
  }
}

function chunk<T>(rows: T[], size = INSERT_BATCH): T[][] {
  const result: T[][] = []
  for (let i = 0; i < rows.length; i += size) result.push(rows.slice(i, i + size))
  return result
}

async function fetchJson(url: URL): Promise<any> {
  const response = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!response.ok) throw new Error(`TUF API ${response.status} ${response.statusText}: ${url.pathname}${url.search}`)
  return response.json()
}

export async function fetchTufSnapshot(apiBase = DEFAULT_API_BASE): Promise<TufRawSnapshot> {
  const levels: unknown[] = []
  let offset = 0
  let page = 1
  let total: number | undefined

  for (let guard = 0; guard < 1000; guard++) {
    const url = new URL(`${apiBase.replace(/\/$/, '')}/levels`)
    url.searchParams.set('page', String(page))
    url.searchParams.set('offset', String(offset))
    url.searchParams.set('limit', String(PAGE_LIMIT))
    url.searchParams.set('deletedFilter', 'hide')

    const payload = await fetchJson(url)
    const results = Array.isArray(payload?.results) ? payload.results : []
    if (typeof payload?.total === 'number') total = payload.total
    levels.push(...results)

    if (!payload?.hasMore || results.length === 0) break
    offset += results.length
    page += 1

    if (guard === 999) throw new Error('TUF level pagination exceeded the safety limit')
  }

  const referencesUrl = new URL(`${apiBase.replace(/\/$/, '')}/references`)
  const references = await fetchJson(referencesUrl)

  return {
    levels,
    references,
    fetchedAt: new Date().toISOString(),
    apiBase,
    levelTotal: total,
  }
}

async function insertLevelObservations(db: DbClient, snapshotId: string, rows: JsonRecord[]) {
  for (const batch of chunk(rows)) {
    await db.query(
      `INSERT INTO external_level_observations(
         snapshot_id,source,external_id,linked_level_id,linked_level_version_id,
         sha256,song,title,creator,download_url,difficulty_label,raw_data
       )
       SELECT $1,'TUF',x.external_id,x.linked_level_id,x.linked_level_version_id,
              x.sha256,x.song,x.title,x.creator,x.download_url,x.difficulty_label,x.raw_data
       FROM jsonb_to_recordset($2::jsonb) AS x(
         external_id text, linked_level_id uuid, linked_level_version_id uuid,
         sha256 text, song text, title text, creator text, download_url text,
         difficulty_label text, raw_data jsonb
       )`,
      [snapshotId, JSON.stringify(batch)],
    )
  }
}

async function insertRatingObservations(db: DbClient, snapshotId: string, rows: JsonRecord[]) {
  for (const batch of chunk(rows)) {
    await db.query(
      `INSERT INTO external_rating_observations(
         level_id,level_version_id,snapshot_id,source,external_id,family,tier,label,raw_data
       )
       SELECT x.linked_level_id,x.linked_level_version_id,$1,'TUF',x.external_id,
              x.family,x.tier,x.label,x.raw_data
       FROM jsonb_to_recordset($2::jsonb) AS x(
         external_id text, linked_level_id uuid, linked_level_version_id uuid,
         family text, tier integer, label text, raw_data jsonb
       )`,
      [snapshotId, JSON.stringify(batch)],
    )
  }
}

async function insertReferenceObservations(db: DbClient, snapshotId: string, rows: JsonRecord[]) {
  for (const batch of chunk(rows)) {
    await db.query(
      `INSERT INTO external_reference_observations(
         snapshot_id,source,external_id,linked_level_id,linked_level_version_id,
         family,tier,difficulty_label,reference_type,raw_data
       )
       SELECT $1,'TUF',x.external_id,x.linked_level_id,x.linked_level_version_id,
              x.family,x.tier,x.difficulty_label,x.reference_type,x.raw_data
       FROM jsonb_to_recordset($2::jsonb) AS x(
         external_id text, linked_level_id uuid, linked_level_version_id uuid,
         family text, tier integer, difficulty_label text, reference_type text, raw_data jsonb
       )`,
      [snapshotId, JSON.stringify(batch)],
    )
  }
}

async function insertIssues(db: DbClient, snapshotId: string, issues: ImportIssue[]) {
  for (const batch of chunk(issues)) {
    await db.query(
      `INSERT INTO import_issues(
         snapshot_id,source,severity,kind,external_id,linked_level_id,linked_level_version_id,details
       )
       SELECT $1,'TUF',x.severity,x.kind,x.external_id,x.linked_level_id,x.linked_level_version_id,x.details
       FROM jsonb_to_recordset($2::jsonb) AS x(
         severity text, kind text, external_id text,
         linked_level_id uuid, linked_level_version_id uuid, details jsonb
       )`,
      [snapshotId, JSON.stringify(batch)],
    )
  }
}

export async function importTufSnapshot(
  db: DbClient,
  input: { rawData: TufRawSnapshot; actorId: string | null; sourceVersion?: string | null },
): Promise<TufImportResult> {
  const rawLevels = Array.isArray(input.rawData?.levels) ? input.rawData.levels : []
  const rawReferenceGroups = Array.isArray(input.rawData?.references) ? input.rawData.references : []
  if (!Array.isArray(input.rawData?.levels)) throw new Error('TUF rawData.levels must be an array')
  if (!Array.isArray(input.rawData?.references)) throw new Error('TUF rawData.references must be an array')

  return inTransaction(db, async () => {
    const sourceVersion = input.sourceVersion
      ?? (input.rawData.fetchedAt ? `v2@${input.rawData.fetchedAt}` : null)

    const snapshotResult = await db.query(
      `INSERT INTO import_snapshots(source,source_version,raw_data,imported_by)
       VALUES ('TUF',$1,$2::jsonb,$3)
       RETURNING id,source,source_version,imported_at`,
      [sourceVersion, JSON.stringify(input.rawData), input.actorId],
    )
    const snapshot = snapshotResult.rows[0]

    const mappingResult = await db.query(
      `SELECT e.external_id,e.level_id,l.current_version_id
       FROM external_level_ids e
       JOIN levels l ON l.id=e.level_id
       WHERE e.source='TUF'`,
    )
    const links = new Map<string, Link>()
    for (const row of mappingResult.rows) {
      links.set(String(row.external_id), { levelId: row.level_id, levelVersionId: row.current_version_id ?? null })
    }

    const normalized = new Map<string, ReturnType<typeof normalizedLevel>>()
    const issues: ImportIssue[] = []
    const firstRatingById = new Map<string, string | null>()

    for (const value of rawLevels) {
      const level = record(value)
      const id = level ? externalId(level.id) : null
      if (!level || !id) {
        issues.push({ severity: 'ERROR', kind: 'INVALID_LEVEL_ID', externalId: null, linkedLevelId: null, linkedLevelVersionId: null, details: { raw: value } })
        continue
      }

      const item = normalizedLevel(level, id)
      if (normalized.has(id)) {
        const previousLabel = firstRatingById.get(id) ?? null
        issues.push({
          severity: previousLabel !== item.difficultyLabel ? 'ERROR' : 'WARNING',
          kind: previousLabel !== item.difficultyLabel ? 'DUPLICATE_EXTERNAL_ID_RATING_CONFLICT' : 'DUPLICATE_EXTERNAL_ID',
          externalId: id,
          linkedLevelId: links.get(id)?.levelId ?? null,
          linkedLevelVersionId: links.get(id)?.levelVersionId ?? null,
          details: { previousDifficulty: previousLabel, duplicateDifficulty: item.difficultyLabel },
        })
        continue
      }
      normalized.set(id, item)
      firstRatingById.set(id, item.difficultyLabel)
    }

    const incomingShas = [...new Set([...normalized.values()].map((x) => x.sha256).filter((x): x is string => !!x))]
    const shaLinks = new Map<string, Link>()
    if (incomingShas.length) {
      const shaResult = await db.query(
        `SELECT lower(sha256) AS sha256,level_id,id AS level_version_id
         FROM level_versions
         WHERE sha256 IS NOT NULL AND lower(sha256)=ANY($1::text[])`,
        [incomingShas],
      )
      for (const row of shaResult.rows) shaLinks.set(row.sha256, { levelId: row.level_id, levelVersionId: row.level_version_id })
    }

    let autoLinkedBySha = 0
    for (const item of normalized.values()) {
      const current = links.get(item.externalId)
      const bySha = item.sha256 ? shaLinks.get(item.sha256) : undefined
      if (current && bySha && current.levelId !== bySha.levelId) {
        issues.push({
          severity: 'ERROR',
          kind: 'EXTERNAL_ID_SHA_MAPPING_CONFLICT',
          externalId: item.externalId,
          linkedLevelId: current.levelId,
          linkedLevelVersionId: current.levelVersionId,
          details: { sha256: item.sha256, shaMatchedLevelId: bySha.levelId, shaMatchedLevelVersionId: bySha.levelVersionId },
        })
      } else if (!current && bySha) {
        await db.query(
          `INSERT INTO external_level_ids(level_id,source,external_id)
           VALUES ($1,'TUF',$2)
           ON CONFLICT(source,external_id) DO NOTHING`,
          [bySha.levelId, item.externalId],
        )
        links.set(item.externalId, bySha)
        autoLinkedBySha += 1
      } else if (current && bySha && current.levelId === bySha.levelId) {
        links.set(item.externalId, { levelId: current.levelId, levelVersionId: bySha.levelVersionId })
      }
    }

    const shaRatings = new Map<string, Set<string>>()
    for (const item of normalized.values()) {
      if (!item.sha256 || !item.difficultyLabel) continue
      const labels = shaRatings.get(item.sha256) ?? new Set<string>()
      labels.add(item.difficultyLabel)
      shaRatings.set(item.sha256, labels)
    }
    for (const [hash, labels] of shaRatings) {
      if (labels.size > 1) {
        issues.push({ severity: 'ERROR', kind: 'SHA_RATING_CONFLICT', externalId: null, linkedLevelId: shaLinks.get(hash)?.levelId ?? null, linkedLevelVersionId: shaLinks.get(hash)?.levelVersionId ?? null, details: { sha256: hash, difficulties: [...labels] } })
      }
    }

    const levelRows: JsonRecord[] = []
    const ratingRows: JsonRecord[] = []
    for (const item of normalized.values()) {
      const link = links.get(item.externalId)
      const parsed = pgu(item.difficultyLabel)
      levelRows.push({
        external_id: item.externalId,
        linked_level_id: link?.levelId ?? null,
        linked_level_version_id: link?.levelVersionId ?? null,
        sha256: item.sha256,
        song: item.song,
        title: item.title,
        creator: item.creator,
        download_url: item.downloadUrl,
        difficulty_label: item.difficultyLabel,
        raw_data: item.rawData,
      })

      if (item.difficultyLabel) {
        ratingRows.push({
          external_id: item.externalId,
          linked_level_id: link?.levelId ?? null,
          linked_level_version_id: link?.levelVersionId ?? null,
          family: parsed?.family ?? null,
          tier: parsed?.tier ?? null,
          label: item.difficultyLabel,
          raw_data: { difficulty: item.difficultyLabel },
        })
      } else {
        issues.push({ severity: 'WARNING', kind: 'MISSING_DIFFICULTY', externalId: item.externalId, linkedLevelId: link?.levelId ?? null, linkedLevelVersionId: link?.levelVersionId ?? null, details: {} })
      }
    }

    const referenceRows: JsonRecord[] = []
    const refKeys = new Set<string>()
    for (const groupValue of rawReferenceGroups) {
      const group = record(groupValue)
      if (!group) {
        issues.push({ severity: 'ERROR', kind: 'INVALID_REFERENCE_GROUP', externalId: null, linkedLevelId: null, linkedLevelVersionId: null, details: { raw: groupValue } })
        continue
      }
      const groupDifficulty = text(record(group.difficulty)?.name) ?? text(group.difficulty)
      const parsed = pgu(groupDifficulty)
      const levels = Array.isArray(group.levels) ? group.levels : []
      if (!Array.isArray(group.levels)) {
        issues.push({ severity: 'ERROR', kind: 'INVALID_REFERENCE_LEVELS', externalId: null, linkedLevelId: null, linkedLevelVersionId: null, details: { difficulty: groupDifficulty } })
      }

      for (const levelValue of levels) {
        const level = record(levelValue)
        const id = level ? externalId(level.id) : null
        if (!level || !id) {
          issues.push({ severity: 'ERROR', kind: 'INVALID_REFERENCE_LEVEL_ID', externalId: null, linkedLevelId: null, linkedLevelVersionId: null, details: { difficulty: groupDifficulty, raw: levelValue } })
          continue
        }
        const referenceType = text(level.type)?.toUpperCase() ?? 'UNKNOWN'
        const key = `${id}|${groupDifficulty ?? ''}|${referenceType}`
        if (refKeys.has(key)) {
          issues.push({ severity: 'WARNING', kind: 'DUPLICATE_REFERENCE', externalId: id, linkedLevelId: links.get(id)?.levelId ?? null, linkedLevelVersionId: links.get(id)?.levelVersionId ?? null, details: { difficulty: groupDifficulty, referenceType } })
          continue
        }
        refKeys.add(key)

        const link = links.get(id)
        if (!normalized.has(id)) {
          issues.push({ severity: 'WARNING', kind: 'REFERENCE_LEVEL_NOT_IN_LEVEL_SNAPSHOT', externalId: id, linkedLevelId: link?.levelId ?? null, linkedLevelVersionId: link?.levelVersionId ?? null, details: { difficulty: groupDifficulty, referenceType } })
        }
        if (!groupDifficulty || !parsed) {
          issues.push({ severity: 'WARNING', kind: 'INVALID_REFERENCE_DIFFICULTY', externalId: id, linkedLevelId: link?.levelId ?? null, linkedLevelVersionId: link?.levelVersionId ?? null, details: { difficulty: groupDifficulty, referenceType } })
        }
        if (referenceType === 'UNKNOWN') {
          issues.push({ severity: 'WARNING', kind: 'MISSING_REFERENCE_TYPE', externalId: id, linkedLevelId: link?.levelId ?? null, linkedLevelVersionId: link?.levelVersionId ?? null, details: { difficulty: groupDifficulty } })
        }

        referenceRows.push({
          external_id: id,
          linked_level_id: link?.levelId ?? null,
          linked_level_version_id: link?.levelVersionId ?? null,
          family: parsed?.family ?? null,
          tier: parsed?.tier ?? null,
          difficulty_label: groupDifficulty,
          reference_type: referenceType,
          raw_data: level,
        })
      }
    }

    await insertLevelObservations(db, snapshot.id, levelRows)
    await insertRatingObservations(db, snapshot.id, ratingRows)
    await insertReferenceObservations(db, snapshot.id, referenceRows)
    await insertIssues(db, snapshot.id, issues)

    const issueCounts: Record<Severity, number> = { INFO: 0, WARNING: 0, ERROR: 0 }
    for (const issue of issues) issueCounts[issue.severity] += 1

    const linkedLevels = levelRows.filter((row) => row.linked_level_id).length
    await audit(db, input.actorId, 'TUF_IMPORT', 'import_snapshot', snapshot.id, {
      levels: levelRows.length,
      ratingObservations: ratingRows.length,
      referenceObservations: referenceRows.length,
      linkedLevels,
      autoLinkedBySha,
      issues: issueCounts,
    })

    return {
      snapshot: {
        id: snapshot.id,
        source: snapshot.source,
        sourceVersion: snapshot.source_version,
        importedAt: snapshot.imported_at,
      },
      summary: {
        levels: levelRows.length,
        ratingObservations: ratingRows.length,
        referenceObservations: referenceRows.length,
        linkedLevels,
        autoLinkedBySha,
        issues: issueCounts,
      },
    }
  })
}
