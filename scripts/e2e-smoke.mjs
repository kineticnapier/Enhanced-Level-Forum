import { pbkdf2Sync, randomBytes } from 'node:crypto'
import pg from 'pg'
import { resolveDatabaseUrl } from './local-env.mjs'

const { Client } = pg
const API_URL = (process.env.ELF_API_URL?.trim() || 'http://localhost:8787/api').replace(/\/$/, '')
const ORIGIN = process.env.ELF_E2E_ORIGIN?.trim() || 'http://localhost:5174'
const databaseUrl = await resolveDatabaseUrl()
const db = new Client({ connectionString: databaseUrl })

function base64Url(bytes) {
  return Buffer.from(bytes).toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '')
}

function hashPassword(password) {
  const iterations = 210_000
  const salt = randomBytes(16)
  const hash = pbkdf2Sync(password, salt, iterations, 32, 'sha256')
  return `pbkdf2-sha256$${iterations}$${base64Url(salt)}$${base64Url(hash)}`
}

let cookie = ''
async function request(path, { method = 'GET', body, authenticated = true } = {}) {
  const headers = { Origin: ORIGIN }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (authenticated && cookie) headers.Cookie = cookie
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(`${method} ${path} -> ${response.status}: ${JSON.stringify(payload)}`)
  }
  return { response, payload }
}

let userId = null
let levelId = null
let snapshotId = null
let connected = false
const suffix = `${Date.now()}-${randomBytes(4).toString('hex')}`
const email = `elf-e2e-${suffix}@example.invalid`
const password = `elf-e2e-${randomBytes(16).toString('hex')}`
const versionSha = randomBytes(32).toString('hex')
const tufExternalId = String(1_500_000_000 + (randomBytes(4).readUInt32BE(0) % 400_000_000))
const tufSpecialId = String(Number(tufExternalId) + 1)

try {
  let health
  try {
    health = await fetch(`${API_URL}/health`)
  } catch (error) {
    throw new Error(`Cannot reach ELF API at ${API_URL}. Start it with "npm run dev:api" first. (${error?.message ?? error})`)
  }
  if (!health.ok) {
    throw new Error(`ELF API is not healthy at ${API_URL}. Start it with "npm run dev:api" first.`)
  }

  await db.connect()
  connected = true
} catch (error) {
  if (connected) await db.end().catch(() => undefined)
  throw error
}

try {
  const insertedUser = await db.query(
    `INSERT INTO users(email, display_name, role, password_hash)
     VALUES ($1, $2, 'ADMIN', $3)
     RETURNING id`,
    [email, 'ELF E2E', hashPassword(password)],
  )
  userId = insertedUser.rows[0].id

  const login = await request('/auth/login', {
    method: 'POST',
    body: { email, password },
    authenticated: false,
  })
  const setCookie = login.response.headers.get('set-cookie')
  cookie = setCookie?.split(';', 1)[0] ?? ''
  if (!cookie) throw new Error('login succeeded but no session cookie was returned')

  const created = (await request('/admin/levels', {
    method: 'POST',
    body: {
      song: `E2E Song ${suffix}`,
      title: `ELF E2E ${suffix}`,
      creator: 'ELF test runner',
      version: {
        label: 'Original',
        sha256: versionSha,
      },
    },
  })).payload
  levelId = created.level.id
  const versionId = created.version.id

  await request(`/admin/levels/${levelId}/ratings`, {
    method: 'POST',
    body: { levelVersionId: versionId, family: 'G', tier: 9, confidence: 0.8, reason: 'E2E initial rating' },
  })

  const reference = (await request('/admin/references', {
    method: 'POST',
    body: { levelVersionId: versionId, family: 'G', tier: 9, technique: 'TECH', positionHint: 0, confidence: 0.8 },
  })).payload.reference
  if (reference.status !== 'ACTIVE') throw new Error(`expected ACTIVE reference, got ${reference.status}`)

  await request(`/admin/levels/${levelId}/ratings`, {
    method: 'POST',
    body: { levelVersionId: versionId, family: 'G', tier: 10, confidence: 0.8, reason: 'E2E rerate' },
  })

  const detail = (await request(`/levels/${levelId}`)).payload
  const movedReference = detail.references.find((row) => row.id === reference.id)
  if (movedReference?.status !== 'NEEDS_REVIEW') {
    throw new Error(`expected reference NEEDS_REVIEW after rerate, got ${movedReference?.status ?? 'missing'}`)
  }

  const proposal = (await request('/proposals', {
    method: 'POST',
    body: {
      type: 'OTHER',
      levelId,
      title: `E2E proposal ${suffix}`,
      reason: 'E2E governance flow',
      payload: { note: 'status-only baseline proposal' },
    },
  })).payload.proposal

  await request(`/admin/proposals/${proposal.id}/decision`, {
    method: 'PATCH',
    body: { status: 'APPROVED', reason: 'E2E approval' },
  })

  const audit = (await request('/admin/audit')).payload.audit
  if (!audit.some((row) => row.actor_id === userId && row.action === 'CANONICAL_RERATE')) {
    throw new Error('expected CANONICAL_RERATE audit entry')
  }

  const canonicalBefore = Number((await db.query(
    `SELECT count(*)::int AS count FROM canonical_ratings WHERE level_version_id=$1`,
    [versionId],
  )).rows[0].count)
  const referencesBefore = Number((await db.query(
    `SELECT count(*)::int AS count FROM difficulty_references WHERE level_version_id=$1`,
    [versionId],
  )).rows[0].count)

  const imported = (await request('/admin/imports/tuf', {
    method: 'POST',
    body: {
      sourceVersion: `e2e:${suffix}`,
      rawData: {
        fetchedAt: new Date().toISOString(),
        levels: [
          {
            id: Number(tufExternalId),
            song: `TUF linked ${suffix}`,
            charter: 'ELF test runner',
            difficulty: { name: 'G9' },
            dlLink: 'https://example.invalid/level.zip',
            sha256: versionSha,
          },
          {
            id: Number(tufSpecialId),
            song: `TUF special ${suffix}`,
            charter: 'ELF test runner',
            difficulty: { name: 'Impossible' },
          },
        ],
        references: [
          {
            difficulty: { name: 'G9' },
            levels: [{ id: Number(tufExternalId), type: 'TECH' }],
          },
        ],
      },
    },
  })).payload
  snapshotId = imported.snapshot.id

  if (imported.summary.levels !== 2) throw new Error(`expected 2 imported levels, got ${imported.summary.levels}`)
  if (imported.summary.ratingObservations !== 2) throw new Error(`expected 2 external ratings, got ${imported.summary.ratingObservations}`)
  if (imported.summary.referenceObservations !== 1) throw new Error(`expected 1 external reference, got ${imported.summary.referenceObservations}`)
  if (imported.summary.linkedLevels !== 1 || imported.summary.autoLinkedBySha !== 1) {
    throw new Error(`expected one SHA-linked level, got linked=${imported.summary.linkedLevels}, auto=${imported.summary.autoLinkedBySha}`)
  }

  const mapping = await db.query(
    `SELECT level_id FROM external_level_ids WHERE source='TUF' AND external_id=$1`,
    [tufExternalId],
  )
  if (mapping.rows[0]?.level_id !== levelId) throw new Error('TUF SHA match did not create the expected external ID mapping')

  const special = await db.query(
    `SELECT family,tier,label FROM external_rating_observations
     WHERE snapshot_id=$1 AND external_id=$2`,
    [snapshotId, tufSpecialId],
  )
  if (special.rows[0]?.family !== null || special.rows[0]?.tier !== null || special.rows[0]?.label !== 'Impossible') {
    throw new Error(`special TUF difficulty was not preserved externally: ${JSON.stringify(special.rows[0])}`)
  }

  const canonicalAfter = Number((await db.query(
    `SELECT count(*)::int AS count FROM canonical_ratings WHERE level_version_id=$1`,
    [versionId],
  )).rows[0].count)
  const referencesAfter = Number((await db.query(
    `SELECT count(*)::int AS count FROM difficulty_references WHERE level_version_id=$1`,
    [versionId],
  )).rows[0].count)
  if (canonicalAfter !== canonicalBefore || referencesAfter !== referencesBefore) {
    throw new Error('TUF import mutated canonical_ratings or difficulty_references')
  }

  const importSummary = (await request(`/admin/imports/tuf/summary?snapshotId=${snapshotId}`)).payload.summary
  if (importSummary.levels !== 2 || importSummary.references !== 1) throw new Error('TUF import summary endpoint returned unexpected counts')
  await request(`/admin/imports/tuf/issues?snapshotId=${snapshotId}`)

  console.log('E2E SMOKE PASSED')
  console.log('login -> level -> G9 -> reference -> G10 -> NEEDS_REVIEW -> proposal -> approve -> audit')
  console.log('TUF fixture -> external observations -> SHA link -> special label preserved -> canonical tables unchanged')
} finally {
  if (connected) {
    try {
      if (snapshotId) await db.query('DELETE FROM import_snapshots WHERE id = $1', [snapshotId])
      if (levelId) {
        await db.query('UPDATE levels SET current_version_id = NULL WHERE id = $1', [levelId])
        await db.query('DELETE FROM levels WHERE id = $1', [levelId])
      }
      if (userId) {
        await db.query('DELETE FROM audit_log WHERE actor_id = $1', [userId])
        await db.query('DELETE FROM users WHERE id = $1', [userId])
      }
    } finally {
      await db.end()
    }
  }
}
