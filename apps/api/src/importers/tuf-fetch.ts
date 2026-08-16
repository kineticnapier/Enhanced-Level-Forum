import type { TufRawSnapshot } from './tuf'

const DEFAULT_API_BASE = 'https://api.tuforums.com/v2/database'
const PAGE_LIMIT = 100
const LEVEL_SORT = 'RECENT_ASC'
const MAX_ATTEMPTS = 4
const REQUIRED_STABLE_PASSES = 2
const REQUEST_ATTEMPTS = 4
const REQUEST_RETRY_BASE_MS = 500
const PAGE_DELAY_MS = 25
const STABLE_SCAN_DELAY_MS = 1000

type JsonRecord = Record<string, unknown>

type LevelPass = {
  levels: unknown[]
  ids: string[]
  total: number
  pageTotals: number[]
  duplicateIds: string[]
}

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

function sameIds(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index])
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function retryableStatus(status: number): boolean {
  return status === 429 || status >= 500
}

async function fetchJson(url: URL): Promise<any> {
  let lastProblem = `TUF API request failed: ${url.pathname}${url.search}`

  for (let attempt = 1; attempt <= REQUEST_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url, { headers: { Accept: 'application/json' } })
      if (response.ok) return response.json()

      lastProblem = `TUF API ${response.status} ${response.statusText}: ${url.pathname}${url.search}`
      if (!retryableStatus(response.status) || attempt === REQUEST_ATTEMPTS) {
        throw new Error(lastProblem)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      lastProblem = message
      if (attempt === REQUEST_ATTEMPTS) throw error
    }

    const delayMs = REQUEST_RETRY_BASE_MS * 2 ** (attempt - 1)
    console.warn(
      `[TUF import] transient request failure; retry ${attempt + 1}/${REQUEST_ATTEMPTS} in ${delayMs}ms: ${lastProblem}`,
    )
    await sleep(delayMs)
  }

  throw new Error(lastProblem)
}

async function fetchLevelPass(apiBase: string): Promise<LevelPass> {
  const levels: unknown[] = []
  const ids: string[] = []
  const pageTotals: number[] = []
  const seen = new Set<string>()
  const duplicateIds = new Set<string>()

  let offset = 0
  let page = 1

  for (let guard = 0; guard < 1000; guard++) {
    const url = new URL(`${apiBase.replace(/\/$/, '')}/levels`)
    url.searchParams.set('page', String(page))
    url.searchParams.set('offset', String(offset))
    url.searchParams.set('limit', String(PAGE_LIMIT))
    url.searchParams.set('deletedFilter', 'hide')
    // TUF implements RECENT_ASC as an ascending id sort. New levels therefore
    // append after the already-scanned range instead of shifting every later
    // offset, which is what caused the observed page-boundary duplicate.
    url.searchParams.set('sort', LEVEL_SORT)

    const payload = await fetchJson(url)
    const results = Array.isArray(payload?.results) ? payload.results : []
    if (!Number.isInteger(payload?.total) || payload.total < 0) {
      throw new Error(`TUF level page ${page} returned an invalid total`)
    }
    pageTotals.push(payload.total)

    for (const value of results) {
      levels.push(value)
      const id = sourceLevelId(record(value)?.id)
      // Malformed source ids are still preserved for the normal importer to
      // diagnose. They get a positional consistency key instead of being
      // silently discarded during the network snapshot phase.
      const key = id ?? `!invalid:${ids.length}`
      ids.push(key)
      if (id) {
        if (seen.has(id)) duplicateIds.add(id)
        seen.add(id)
      }
    }

    if (!payload?.hasMore || results.length === 0) break
    offset += results.length
    page += 1

    // A complete pass currently spans many TUF API requests. A very small
    // delay avoids immediately hammering the upstream service while adding
    // only a few seconds to a full scheduled scan.
    await sleep(PAGE_DELAY_MS)

    if (guard === 999) throw new Error('TUF level pagination exceeded the safety limit')
  }

  const total = pageTotals.at(-1) ?? 0
  return {
    levels,
    ids,
    total,
    pageTotals,
    duplicateIds: [...duplicateIds].sort((a, b) => Number(a) - Number(b)),
  }
}

function passProblem(pass: LevelPass): string | null {
  const firstTotal = pass.pageTotals[0] ?? pass.total
  if (!pass.pageTotals.every((total) => total === firstTotal)) {
    return `TUF total changed during pagination (${firstTotal} -> ${pass.total})`
  }
  if (pass.duplicateIds.length) {
    const sample = pass.duplicateIds.slice(0, 5).join(', ')
    return `duplicate TUF level ids during pagination: ${sample}${pass.duplicateIds.length > 5 ? ', ...' : ''}`
  }
  if (pass.levels.length !== pass.total) {
    return `TUF pagination count mismatch: fetched=${pass.levels.length}, total=${pass.total}`
  }
  return null
}

export async function fetchConsistentTufSnapshot(
  apiBase = DEFAULT_API_BASE,
): Promise<TufRawSnapshot> {
  let previous: LevelPass | null = null
  let lastProblem = 'no level pass completed'

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const current = await fetchLevelPass(apiBase)
      const problem = passProblem(current)
      if (problem) {
        lastProblem = problem
        previous = null
        console.warn(`[TUF import] level scan ${attempt}/${MAX_ATTEMPTS} rejected: ${problem}`)
      } else if (previous && current.total === previous.total && sameIds(current.ids, previous.ids)) {
        const referencesUrl = new URL(`${apiBase.replace(/\/$/, '')}/references`)
        const references = await fetchJson(referencesUrl)
        return {
          levels: current.levels,
          references,
          fetchedAt: new Date().toISOString(),
          apiBase,
          levelTotal: current.total,
        }
      } else {
        lastProblem = previous
          ? `level id sequence changed between consecutive successful scans (${previous.total} -> ${current.total})`
          : `waiting for ${REQUIRED_STABLE_PASSES} consecutive stable scans`
        previous = current
        console.warn(`[TUF import] level scan ${attempt}/${MAX_ATTEMPTS} valid; ${lastProblem}`)
        if (attempt < MAX_ATTEMPTS) await sleep(STABLE_SCAN_DELAY_MS)
      }
    } catch (error) {
      lastProblem = error instanceof Error ? error.message : String(error)
      // A transient network/upstream failure does not invalidate the most
      // recent complete pass. The next complete pass can still be compared
      // against it; any source change will be detected by total/id mismatch.
      console.warn(`[TUF import] level scan ${attempt}/${MAX_ATTEMPTS} failed: ${lastProblem}`)
    }
  }

  throw new Error(
    `Could not obtain a consistent TUF level snapshot after ${MAX_ATTEMPTS} scan attempts: ${lastProblem}`,
  )
}
