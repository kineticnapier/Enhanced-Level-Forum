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
let connected = false
const suffix = `${Date.now()}-${randomBytes(4).toString('hex')}`
const email = `elf-proposal-execution-${suffix}@example.invalid`
const password = `elf-proposal-execution-${randomBytes(16).toString('hex')}`

try {
  const health = await fetch(`${API_URL}/health`).catch(() => null)
  if (!health?.ok) throw new Error(`ELF API is not healthy at ${API_URL}. Start it with "npm run dev:api" first.`)
  await db.connect()
  connected = true

  const insertedUser = await db.query(
    `INSERT INTO users(email,display_name,role,password_hash)
     VALUES ($1,$2,'ADMIN',$3)
     RETURNING id`,
    [email, 'ELF proposal execution E2E', hashPassword(password)],
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
      song: `Proposal execution ${suffix}`,
      title: `Proposal execution ${suffix}`,
      creator: 'ELF test runner',
      version: { label: 'Original' },
    },
  })).payload
  levelId = created.level.id
  const versionId = created.version.id

  await request(`/admin/levels/${levelId}/ratings`, {
    method: 'POST',
    body: { levelVersionId: versionId, family: 'G', tier: 8, confidence: 0.9, reason: 'proposal execution baseline' },
  })

  const reference = (await request('/admin/references', {
    method: 'POST',
    body: { levelVersionId: versionId, family: 'G', tier: 8, technique: 'TECH', positionHint: 0, confidence: 0.9 },
  })).payload.reference
  if (reference.status !== 'ACTIVE') throw new Error(`expected ACTIVE reference before proposal execution, got ${reference.status}`)

  const proposal = (await request('/proposals', {
    method: 'POST',
    body: {
      type: 'RERATE',
      levelId,
      title: 'Execute G8 -> G10',
      reason: 'E2E approved rerate proposal',
      payload: {
        targetLevelVersionId: versionId,
        currentCanonicalRating: { family: 'G', tier: 8 },
        proposedRating: { family: 'G', tier: 10 },
      },
    },
  })).payload.proposal

  const approved = (await request(`/admin/proposals/${proposal.id}/decision`, {
    method: 'PATCH',
    body: { status: 'APPROVED', reason: 'Approved by proposal execution E2E' },
  })).payload

  if (approved.proposal?.status !== 'APPROVED') throw new Error(`proposal was not approved: ${JSON.stringify(approved)}`)
  if (approved.execution?.type !== 'RERATE' || approved.execution?.rating?.family !== 'G' || approved.execution?.rating?.tier !== 10) {
    throw new Error(`RERATE execution result is wrong: ${JSON.stringify(approved.execution)}`)
  }
  if (!approved.execution?.staleReferenceIds?.includes(reference.id)) {
    throw new Error(`executed rerate did not report stale reference: ${JSON.stringify(approved.execution)}`)
  }

  const current = await db.query(
    `SELECT family,tier FROM canonical_ratings
     WHERE level_version_id=$1 AND effective_to IS NULL`,
    [versionId],
  )
  if (current.rows[0]?.family !== 'G' || Number(current.rows[0]?.tier) !== 10) {
    throw new Error(`approved proposal did not publish G10: ${JSON.stringify(current.rows[0])}`)
  }

  const history = await db.query(
    `SELECT family,tier,effective_to FROM canonical_ratings
     WHERE level_version_id=$1 ORDER BY effective_from`,
    [versionId],
  )
  if (history.rowCount !== 2 || history.rows[0].effective_to === null || history.rows[1].effective_to !== null) {
    throw new Error(`canonical history was not versioned correctly: ${JSON.stringify(history.rows)}`)
  }

  const refAfter = await db.query(`SELECT status FROM difficulty_references WHERE id=$1`, [reference.id])
  if (refAfter.rows[0]?.status !== 'NEEDS_REVIEW') {
    throw new Error(`reference was not marked NEEDS_REVIEW: ${JSON.stringify(refAfter.rows[0])}`)
  }
  const refHistory = await db.query(
    `SELECT action FROM reference_history WHERE reference_id=$1 ORDER BY created_at`,
    [reference.id],
  )
  if (!refHistory.rows.some((row) => row.action === 'AUTO_REVIEW_AFTER_RERATE')) {
    throw new Error('AUTO_REVIEW_AFTER_RERATE history entry missing')
  }

  const executionAudit = await db.query(
    `SELECT action,details FROM audit_log
     WHERE actor_id=$1 AND entity_id=$2 AND action IN ('PROPOSAL_DECISION','PROPOSAL_EXECUTION')
     ORDER BY created_at`,
    [userId, proposal.id],
  )
  if (!executionAudit.rows.some((row) => row.action === 'PROPOSAL_EXECUTION' && row.details?.proposedRating?.tier === 10)) {
    throw new Error(`PROPOSAL_EXECUTION audit missing: ${JSON.stringify(executionAudit.rows)}`)
  }

  const staleProposal = (await request('/proposals', {
    method: 'POST',
    body: {
      type: 'RERATE',
      levelId,
      title: 'Stale G10 -> G12',
      reason: 'This proposal should become stale',
      payload: {
        targetLevelVersionId: versionId,
        currentCanonicalRating: { family: 'G', tier: 10 },
        proposedRating: { family: 'G', tier: 12 },
      },
    },
  })).payload.proposal

  await request(`/admin/levels/${levelId}/ratings`, {
    method: 'POST',
    body: { levelVersionId: versionId, family: 'G', tier: 11, confidence: 0.7, reason: 'intervening direct rerate' },
  })
  const countBeforeStaleApproval = Number((await db.query(
    `SELECT count(*)::int AS count FROM canonical_ratings WHERE level_version_id=$1`,
    [versionId],
  )).rows[0].count)

  const stale = await request(`/admin/proposals/${staleProposal.id}/decision`, {
    method: 'PATCH',
    body: { status: 'APPROVED', reason: 'should fail as stale' },
    expectedStatus: 409,
  })
  if (!String(stale.payload?.error ?? '').includes('Proposal baseline is stale')) {
    throw new Error(`unexpected stale guard response: ${JSON.stringify(stale.payload)}`)
  }

  const staleStored = await db.query(`SELECT status,decided_at FROM proposals WHERE id=$1`, [staleProposal.id])
  if (staleStored.rows[0]?.status !== 'OPEN' || staleStored.rows[0]?.decided_at !== null) {
    throw new Error(`stale proposal was mutated despite rollback: ${JSON.stringify(staleStored.rows[0])}`)
  }
  const currentAfterStale = await db.query(
    `SELECT family,tier FROM canonical_ratings WHERE level_version_id=$1 AND effective_to IS NULL`,
    [versionId],
  )
  if (currentAfterStale.rows[0]?.family !== 'G' || Number(currentAfterStale.rows[0]?.tier) !== 11) {
    throw new Error(`stale approval changed canonical rating: ${JSON.stringify(currentAfterStale.rows[0])}`)
  }
  const countAfterStaleApproval = Number((await db.query(
    `SELECT count(*)::int AS count FROM canonical_ratings WHERE level_version_id=$1`,
    [versionId],
  )).rows[0].count)
  if (countAfterStaleApproval !== countBeforeStaleApproval) {
    throw new Error('stale approval inserted canonical history despite rollback')
  }

  const malformed = (await request('/proposals', {
    method: 'POST',
    body: {
      type: 'RERATE',
      levelId,
      title: 'Malformed rerate payload',
      reason: 'must not execute without baseline/version contract',
      payload: { family: 'G', tier: 20 },
    },
  })).payload.proposal
  const malformedResult = await request(`/admin/proposals/${malformed.id}/decision`, {
    method: 'PATCH',
    body: { status: 'APPROVED' },
    expectedStatus: 409,
  })
  if (!String(malformedResult.payload?.error ?? '').includes('cannot be executed safely')) {
    throw new Error(`malformed RERATE guard returned unexpected response: ${JSON.stringify(malformedResult.payload)}`)
  }
  const malformedStored = await db.query(`SELECT status FROM proposals WHERE id=$1`, [malformed.id])
  if (malformedStored.rows[0]?.status !== 'OPEN') throw new Error('malformed RERATE proposal should remain OPEN')

  console.log('PROPOSAL EXECUTION E2E PASSED')
  console.log('G8 proposal -> approve -> G10 -> Reference NEEDS_REVIEW -> audit; stale baseline -> 409 rollback; malformed RERATE -> 409')
} finally {
  if (connected) {
    try {
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
