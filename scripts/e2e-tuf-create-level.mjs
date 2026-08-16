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
  const response = await fetch(`${API_URL}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const payload = await response.json().catch(() => null)
  if (expectedStatus !== null) {
    if (response.status !== expectedStatus) throw new Error(`${method} ${path} -> ${response.status}, expected ${expectedStatus}: ${JSON.stringify(payload)}`)
  } else if (!response.ok) {
    throw new Error(`${method} ${path} -> ${response.status}: ${JSON.stringify(payload)}`)
  }
  return { response, payload }
}

let userId = null
let levelId = null
const snapshotIds = []
let connected = false
const suffix = `${Date.now()}-${randomBytes(4).toString('hex')}`
const email = `elf-tuf-create-${suffix}@example.invalid`
const password = `elf-tuf-create-${randomBytes(16).toString('hex')}`
const sha = randomBytes(32).toString('hex')
const externalId = String(1_300_000_000 + (randomBytes(4).readUInt32BE(0) % 100_000_000))

try {
  const health = await fetch(`${API_URL}/health`).catch(() => null)
  if (!health?.ok) throw new Error(`ELF API is not healthy at ${API_URL}. Start it with "npm run dev:api" first.`)
  await db.connect()
  connected = true

  const user = await db.query(
    `INSERT INTO users(email,display_name,role,password_hash) VALUES ($1,$2,'ADMIN',$3) RETURNING id`,
    [email, 'ELF TUF create E2E', hashPassword(password)],
  )
  userId = user.rows[0].id
  const login = await request('/auth/login', { method: 'POST', body: { email, password }, authenticated: false })
  cookie = login.response.headers.get('set-cookie')?.split(';', 1)[0] ?? ''
  if (!cookie) throw new Error('login succeeded but no session cookie was returned')

  const first = (await request('/admin/imports/tuf', {
    method: 'POST',
    body: {
      sourceVersion: `tuf-create-first:${suffix}`,
      rawData: {
        fetchedAt: new Date().toISOString(),
        levels: [{ id: Number(externalId), song: `TUF source song ${suffix}`, charter: 'TUF source creator', difficulty: { name: 'G8' }, sha256: sha, dlLink: 'https://example.invalid/source.zip' }],
        references: [],
      },
    },
  })).payload
  snapshotIds.push(first.snapshot.id)

  const second = (await request('/admin/imports/tuf', {
    method: 'POST',
    body: {
      sourceVersion: `tuf-create-second:${suffix}`,
      rawData: {
        fetchedAt: new Date().toISOString(),
        levels: [{ id: Number(externalId), song: `TUF source song ${suffix}`, charter: 'TUF source creator', difficulty: { name: 'G9' }, sha256: sha, dlLink: 'https://example.invalid/source.zip' }],
        references: [],
      },
    },
  })).payload
  snapshotIds.push(second.snapshot.id)

  const queue = (await request(`/admin/imports/tuf/unlinked?search=${encodeURIComponent(externalId)}`)).payload
  if (queue.total !== 1 || queue.rows[0]?.externalId !== externalId) throw new Error(`expected latest TUF row in unlinked queue: ${JSON.stringify(queue)}`)
  const observation = queue.rows[0]

  const created = (await request('/admin/imports/tuf/create-level', {
    method: 'POST',
    body: {
      observationId: observation.observationId,
      song: `Reviewed song ${suffix}`,
      title: `Edited ELF title ${suffix}`,
      creator: 'Reviewed ELF creator',
      version: {
        label: 'Imported Original',
        sha256: sha,
        downloadUrl: 'https://example.invalid/reviewed.zip',
        notes: 'Created from TUF evidence after metadata review',
      },
    },
  })).payload
  levelId = created.level.id
  const versionId = created.version.id
  if (created.canonicalRating !== null) throw new Error('TUF Level creation must not create canonical rating')
  if (created.level.title !== `Edited ELF title ${suffix}` || created.level.creator !== 'Reviewed ELF creator') {
    throw new Error(`edited ELF metadata was not preserved: ${JSON.stringify(created.level)}`)
  }
  if (created.version.label !== 'Imported Original' || created.version.sha256 !== sha) throw new Error(`created Version is wrong: ${JSON.stringify(created.version)}`)

  const level = await db.query(`SELECT song,title,creator,current_version_id FROM levels WHERE id=$1`, [levelId])
  if (level.rows[0]?.song !== `Reviewed song ${suffix}` || level.rows[0]?.current_version_id !== versionId) throw new Error('created Level/current Version mismatch')
  const canonicalCount = Number((await db.query(`SELECT count(*)::int AS count FROM canonical_ratings WHERE level_version_id=$1`, [versionId])).rows[0].count)
  if (canonicalCount !== 0) throw new Error('TUF create-level mutated canonical_ratings')

  const mapping = await db.query(`SELECT level_id FROM external_level_ids WHERE source='TUF' AND external_id=$1`, [externalId])
  if (mapping.rows[0]?.level_id !== levelId) throw new Error('TUF external ID mapping was not created')

  const observations = await db.query(
    `SELECT snapshot_id,linked_level_id,linked_level_version_id FROM external_level_observations
     WHERE source='TUF' AND external_id=$1 ORDER BY observed_at`,
    [externalId],
  )
  if (observations.rowCount !== 2 || observations.rows.some((row) => row.linked_level_id !== levelId)) throw new Error(`historic TUF observations were not linked to the new Level: ${JSON.stringify(observations.rows)}`)
  const latestObservation = observations.rows.find((row) => row.snapshot_id === second.snapshot.id)
  const oldObservation = observations.rows.find((row) => row.snapshot_id === first.snapshot.id)
  if (latestObservation?.linked_level_version_id !== versionId || oldObservation?.linked_level_version_id !== null) {
    throw new Error(`Version linkage must be explicit only for the selected snapshot: ${JSON.stringify(observations.rows)}`)
  }

  const evidence = (await request(`/admin/imports/tuf/evidence?search=${encodeURIComponent(externalId)}`)).payload
  if (evidence.total !== 1 || evidence.rows[0]?.levelId !== levelId || evidence.rows[0]?.tuf?.tier !== 9 || evidence.rows[0]?.elf !== null) {
    throw new Error(`new Level did not enter linked external evidence as Unrated: ${JSON.stringify(evidence)}`)
  }
  if (evidence.rows[0]?.previousTuf?.label !== 'G8' || evidence.rows[0]?.proposalEligible !== true) {
    throw new Error(`TUF history/proposal path was not preserved after create-level: ${JSON.stringify(evidence.rows[0])}`)
  }

  const queueAfter = (await request(`/admin/imports/tuf/unlinked?search=${encodeURIComponent(externalId)}`)).payload
  if (queueAfter.total !== 0) throw new Error('created TUF Level remained in unlinked queue')

  const duplicate = await request('/admin/imports/tuf/create-level', {
    method: 'POST',
    body: { observationId: observation.observationId, title: 'duplicate should fail' },
    expectedStatus: 409,
  })
  if (!String(duplicate.payload?.error ?? '').includes('already linked')) throw new Error(`duplicate create guard returned unexpected response: ${JSON.stringify(duplicate.payload)}`)

  const audits = await db.query(
    `SELECT action,details FROM audit_log WHERE actor_id=$1 AND entity_id=$2 AND action IN ('LEVEL_CREATE','TUF_CREATE_LEVEL')`,
    [userId, levelId],
  )
  if (!audits.rows.some((row) => row.action === 'LEVEL_CREATE' && row.details?.source === 'TUF_RECONCILIATION')) throw new Error('source-aware LEVEL_CREATE audit missing')
  if (!audits.rows.some((row) => row.action === 'TUF_CREATE_LEVEL' && row.details?.canonicalRatingCreated === false)) throw new Error('TUF_CREATE_LEVEL audit missing')

  console.log('TUF CREATE LEVEL E2E PASSED')
  console.log('unlinked TUF -> editable metadata -> Level+Version -> immediate mapping -> historic Level links -> latest Version link -> canonical remains Unrated -> proposal eligible')
} finally {
  if (connected) {
    try {
      for (const snapshotId of snapshotIds.reverse()) await db.query('DELETE FROM import_snapshots WHERE id=$1', [snapshotId])
      if (levelId) {
        await db.query('UPDATE levels SET current_version_id=NULL WHERE id=$1', [levelId])
        await db.query('DELETE FROM levels WHERE id=$1', [levelId])
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
