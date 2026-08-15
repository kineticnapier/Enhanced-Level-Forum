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
let connected = false
const suffix = `${Date.now()}-${randomBytes(4).toString('hex')}`
const email = `elf-e2e-${suffix}@example.invalid`
const password = `elf-e2e-${randomBytes(16).toString('hex')}`

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
        sha256: randomBytes(32).toString('hex'),
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
      type: 'RERATE',
      levelId,
      title: `E2E proposal ${suffix}`,
      reason: 'E2E governance flow',
      payload: { family: 'G', tier: 10 },
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

  console.log('E2E SMOKE PASSED')
  console.log('login -> level -> G9 -> reference -> G10 -> NEEDS_REVIEW -> proposal -> approve -> audit')
} finally {
  if (connected) {
    try {
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
