import { pbkdf2Sync, randomBytes } from 'node:crypto'
import pg from 'pg'
import { resolveDatabaseUrl } from './local-env.mjs'

const { Client } = pg
const API_URL = (process.env.ELF_API_URL?.trim() || 'http://localhost:8787/api').replace(/\/$/, '')
const ORIGIN = process.env.ELF_E2E_ORIGIN?.trim() || 'http://localhost:5174'
const db = new Client({ connectionString: await resolveDatabaseUrl() })

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
async function request(path, { method = 'GET', body, authenticated = true, expectedStatus = null } = {}) {
  const headers = { Origin: ORIGIN }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (authenticated && cookie) headers.Cookie = cookie
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const payload = await response.json().catch(() => null)
  if (expectedStatus !== null) {
    if (response.status !== expectedStatus) {
      throw new Error(`${method} ${path} -> ${response.status}, expected ${expectedStatus}: ${JSON.stringify(payload)}`)
    }
  } else if (!response.ok) {
    throw new Error(`${method} ${path} -> ${response.status}: ${JSON.stringify(payload)}`)
  }
  return { response, payload }
}

let userId = null
let levelId = null
let otherLevelId = null
let snapshotId = null
let connected = false
const suffix = `${Date.now()}-${randomBytes(4).toString('hex')}`
const email = `elf-reconcile-${suffix}@example.invalid`
const password = `elf-reconcile-${randomBytes(16).toString('hex')}`
const versionSha = randomBytes(32).toString('hex')
const tufExternalId = String(1_900_000_000 + (randomBytes(4).readUInt32BE(0) % 200_000_000))

try {
  const health = await fetch(`${API_URL}/health`).catch(() => null)
  if (!health?.ok) throw new Error(`ELF API is not healthy at ${API_URL}. Start it with "npm run dev:api" first.`)
  await db.connect()
  connected = true

  const insertedUser = await db.query(
    `INSERT INTO users(email,display_name,role,password_hash)
     VALUES ($1,$2,'ADMIN',$3)
     RETURNING id`,
    [email, 'ELF reconciliation E2E', hashPassword(password)],
  )
  userId = insertedUser.rows[0].id

  const login = await request('/auth/login', {
    method: 'POST',
    body: { email, password },
    authenticated: false,
  })
  cookie = login.response.headers.get('set-cookie')?.split(';', 1)[0] ?? ''
  if (!cookie) throw new Error('login succeeded but no session cookie was returned')

  const created = (await request('/admin/levels', {
    method: 'POST',
    body: {
      song: `Reconciliation target ${suffix}`,
      title: `Reconciliation target ${suffix}`,
      creator: 'ELF test runner',
      version: { label: 'Original', sha256: versionSha },
    },
  })).payload
  levelId = created.level.id
  const versionId = created.version.id

  const other = (await request('/admin/levels', {
    method: 'POST',
    body: {
      song: `Wrong target ${suffix}`,
      title: `Wrong target ${suffix}`,
      creator: 'ELF test runner',
      version: { label: 'Original' },
    },
  })).payload
  otherLevelId = other.level.id

  const canonicalBefore = Number((await db.query(
    `SELECT count(*)::int AS count
     FROM canonical_ratings cr JOIN level_versions lv ON lv.id=cr.level_version_id
     WHERE lv.level_id=$1`,
    [levelId],
  )).rows[0].count)
  const referencesBefore = Number((await db.query(
    `SELECT count(*)::int AS count
     FROM difficulty_references r JOIN level_versions lv ON lv.id=r.level_version_id
     WHERE lv.level_id=$1`,
    [levelId],
  )).rows[0].count)

  const imported = (await request('/admin/imports/tuf', {
    method: 'POST',
    body: {
      sourceVersion: `reconciliation-e2e:${suffix}`,
      rawData: {
        fetchedAt: new Date().toISOString(),
        levels: [{
          id: Number(tufExternalId),
          song: `Manual link ${suffix}`,
          charter: 'ELF test runner',
          difficulty: { name: 'G11' },
        }],
        references: [{
          difficulty: { name: 'G11' },
          levels: [{ id: Number(tufExternalId), type: 'TECH' }],
        }],
      },
    },
  })).payload
  snapshotId = imported.snapshot.id
  if (imported.summary.linkedLevels !== 0) throw new Error('fixture should begin unlinked')

  const queue = (await request(`/admin/imports/tuf/unlinked?snapshotId=${snapshotId}&search=${encodeURIComponent('Manual link')}`)).payload
  if (queue.total !== 1 || queue.rows.length !== 1) {
    throw new Error(`expected one unlinked TUF row, got ${JSON.stringify(queue)}`)
  }
  const observation = queue.rows[0]
  if (observation.externalId !== tufExternalId || observation.difficultyLabel !== 'G11') {
    throw new Error(`unexpected reconciliation row: ${JSON.stringify(observation)}`)
  }
  if (observation.referenceCount !== 1 || !observation.referenceTypes.includes('TECH')) {
    throw new Error(`reference evidence missing from queue row: ${JSON.stringify(observation)}`)
  }

  await request('/admin/imports/tuf/link', {
    method: 'POST',
    body: { observationId: observation.observationId, levelId, levelVersionId: versionId },
  })

  const mapping = await db.query(
    `SELECT level_id FROM external_level_ids WHERE source='TUF' AND external_id=$1`,
    [tufExternalId],
  )
  if (mapping.rows[0]?.level_id !== levelId) throw new Error('manual reconciliation did not create the TUF ID mapping')

  const linked = await db.query(
    `SELECT linked_level_id,linked_level_version_id
     FROM external_level_observations
     WHERE snapshot_id=$1 AND source='TUF' AND external_id=$2`,
    [snapshotId, tufExternalId],
  )
  if (linked.rows[0]?.linked_level_id !== levelId || linked.rows[0]?.linked_level_version_id !== versionId) {
    throw new Error(`observation link mismatch: ${JSON.stringify(linked.rows[0])}`)
  }

  const ratingLinked = await db.query(
    `SELECT level_id,level_version_id
     FROM external_rating_observations
     WHERE snapshot_id=$1 AND source='TUF' AND external_id=$2`,
    [snapshotId, tufExternalId],
  )
  if (ratingLinked.rows[0]?.level_id !== levelId || ratingLinked.rows[0]?.level_version_id !== versionId) {
    throw new Error(`rating observation link mismatch: ${JSON.stringify(ratingLinked.rows[0])}`)
  }

  const refLinked = await db.query(
    `SELECT linked_level_id,linked_level_version_id
     FROM external_reference_observations
     WHERE snapshot_id=$1 AND source='TUF' AND external_id=$2`,
    [snapshotId, tufExternalId],
  )
  if (refLinked.rows[0]?.linked_level_id !== levelId || refLinked.rows[0]?.linked_level_version_id !== versionId) {
    throw new Error(`reference observation link mismatch: ${JSON.stringify(refLinked.rows[0])}`)
  }

  const afterQueue = (await request(`/admin/imports/tuf/unlinked?snapshotId=${snapshotId}`)).payload
  if (afterQueue.total !== 0) throw new Error(`linked row remained in reconciliation queue: ${JSON.stringify(afterQueue)}`)

  const conflict = await request('/admin/imports/tuf/link', {
    method: 'POST',
    body: { observationId: observation.observationId, levelId: otherLevelId },
    expectedStatus: 409,
  })
  if (!String(conflict.payload?.error ?? '').includes('already mapped')) {
    throw new Error(`unexpected conflict response: ${JSON.stringify(conflict.payload)}`)
  }

  const canonicalAfter = Number((await db.query(
    `SELECT count(*)::int AS count
     FROM canonical_ratings cr JOIN level_versions lv ON lv.id=cr.level_version_id
     WHERE lv.level_id=$1`,
    [levelId],
  )).rows[0].count)
  const referencesAfter = Number((await db.query(
    `SELECT count(*)::int AS count
     FROM difficulty_references r JOIN level_versions lv ON lv.id=r.level_version_id
     WHERE lv.level_id=$1`,
    [levelId],
  )).rows[0].count)
  if (canonicalAfter !== canonicalBefore || referencesAfter !== referencesBefore) {
    throw new Error('manual TUF reconciliation mutated canonical rating/reference tables')
  }

  const audit = await db.query(
    `SELECT action,details FROM audit_log
     WHERE actor_id=$1 AND action='TUF_MANUAL_LINK'
     ORDER BY created_at DESC LIMIT 1`,
    [userId],
  )
  if (!audit.rowCount || audit.rows[0].details?.externalId !== tufExternalId) {
    throw new Error('TUF_MANUAL_LINK audit entry missing')
  }

  console.log('TUF RECONCILIATION E2E PASSED')
  console.log('unlinked queue -> manual Level/Version link -> mapping -> evidence links -> conflict guard -> audit')
} finally {
  if (connected) {
    try {
      if (snapshotId) await db.query('DELETE FROM import_snapshots WHERE id=$1', [snapshotId])
      for (const id of [levelId, otherLevelId].filter(Boolean)) {
        await db.query('UPDATE levels SET current_version_id=NULL WHERE id=$1', [id])
        await db.query('DELETE FROM levels WHERE id=$1', [id])
      }
      if (userId) {
        await db.query('DELETE FROM audit_log WHERE actor_id=$1', [userId])
        await db.query('DELETE FROM users WHERE id=$1', [userId])
      }
    } finally {
      await db.end()
    }
  }
}
