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
    if (response.status !== expectedStatus) throw new Error(`${method} ${path} -> ${response.status}, expected ${expectedStatus}: ${JSON.stringify(payload)}`)
  } else if (!response.ok) {
    throw new Error(`${method} ${path} -> ${response.status}: ${JSON.stringify(payload)}`)
  }
  return { response, payload }
}

let userId = null
let levelId = null
let connected = false
const suffix = `${Date.now()}-${randomBytes(4).toString('hex')}`
const email = `elf-reference-proposals-${suffix}@example.invalid`
const password = `elf-reference-proposals-${randomBytes(16).toString('hex')}`

try {
  const health = await fetch(`${API_URL}/health`).catch(() => null)
  if (!health?.ok) throw new Error(`ELF API is not healthy at ${API_URL}. Start it with "npm run dev:api" first.`)
  await db.connect()
  connected = true

  const insertedUser = await db.query(
    `INSERT INTO users(email,display_name,role,password_hash)
     VALUES ($1,$2,'ADMIN',$3) RETURNING id`,
    [email, 'ELF Reference proposal E2E', hashPassword(password)],
  )
  userId = insertedUser.rows[0].id

  const login = await request('/auth/login', { method: 'POST', body: { email, password }, authenticated: false })
  cookie = login.response.headers.get('set-cookie')?.split(';', 1)[0] ?? ''
  if (!cookie) throw new Error('login succeeded but no session cookie was returned')

  const created = (await request('/admin/levels', {
    method: 'POST',
    body: { song: `Reference proposals ${suffix}`, title: `Reference proposals ${suffix}`, creator: 'ELF test runner', version: { label: 'Original' } },
  })).payload
  levelId = created.level.id
  const versionId = created.version.id

  await request(`/admin/levels/${levelId}/ratings`, {
    method: 'POST',
    body: { levelVersionId: versionId, family: 'G', tier: 8, confidence: 0.9, reason: 'Reference proposal baseline' },
  })

  const addProposal = (await request('/proposals', {
    method: 'POST',
    body: {
      type: 'REFERENCE_ADD',
      levelId,
      title: 'Add G8 TECH Reference',
      reason: 'Reference proposal add E2E',
      payload: {
        levelVersionId: versionId,
        reference: { family: 'G', tier: 8, technique: 'TECH', positionHint: 0, confidence: 0.9, notes: 'E2E add' },
      },
    },
  })).payload.proposal
  if (addProposal.payload?.currentCanonicalRating?.tier !== 8 || addProposal.payload?.reference?.technique !== 'TECH') {
    throw new Error(`REFERENCE_ADD did not capture authoritative baseline: ${JSON.stringify(addProposal.payload)}`)
  }

  const addApproved = (await request(`/admin/proposals/${addProposal.id}/decision`, {
    method: 'PATCH', body: { status: 'APPROVED', reason: 'approve add' },
  })).payload
  if (addApproved.execution?.type !== 'REFERENCE_ADD') throw new Error(`REFERENCE_ADD was not executed: ${JSON.stringify(addApproved)}`)
  const referenceId = addApproved.execution.referenceId
  const addedRef = await db.query(`SELECT * FROM difficulty_references WHERE id=$1`, [referenceId])
  if (addedRef.rows[0]?.status !== 'ACTIVE' || addedRef.rows[0]?.family !== 'G' || Number(addedRef.rows[0]?.tier) !== 8) {
    throw new Error(`added Reference is wrong: ${JSON.stringify(addedRef.rows[0])}`)
  }

  await request(`/admin/levels/${levelId}/ratings`, {
    method: 'POST',
    body: { levelVersionId: versionId, family: 'G', tier: 9, confidence: 0.8, reason: 'Move Reference target' },
  })
  const afterRerate = await db.query(`SELECT status FROM difficulty_references WHERE id=$1`, [referenceId])
  if (afterRerate.rows[0]?.status !== 'NEEDS_REVIEW') throw new Error('rerate should mark the G8 Reference NEEDS_REVIEW before move proposal')

  const moveProposal = (await request('/proposals', {
    method: 'POST',
    body: {
      type: 'REFERENCE_MOVE',
      levelId,
      title: 'Move TECH Reference G8 -> G9',
      reason: 'Reference proposal move E2E',
      payload: { referenceId, target: { family: 'G', tier: 9, positionHint: 1 } },
    },
  })).payload.proposal
  if (moveProposal.payload?.baselineReference?.status !== 'NEEDS_REVIEW' || moveProposal.payload?.currentCanonicalRating?.tier !== 9) {
    throw new Error(`REFERENCE_MOVE did not capture Reference/canonical baseline: ${JSON.stringify(moveProposal.payload)}`)
  }

  const moveApproved = (await request(`/admin/proposals/${moveProposal.id}/decision`, {
    method: 'PATCH', body: { status: 'APPROVED', reason: 'approve move' },
  })).payload
  if (moveApproved.execution?.type !== 'REFERENCE_MOVE') throw new Error(`REFERENCE_MOVE was not executed: ${JSON.stringify(moveApproved)}`)
  const movedRef = await db.query(`SELECT family,tier,position_hint,status FROM difficulty_references WHERE id=$1`, [referenceId])
  if (movedRef.rows[0]?.family !== 'G' || Number(movedRef.rows[0]?.tier) !== 9 || Number(movedRef.rows[0]?.position_hint) !== 1 || movedRef.rows[0]?.status !== 'ACTIVE') {
    throw new Error(`Reference move result is wrong: ${JSON.stringify(movedRef.rows[0])}`)
  }

  const staleProposal = (await request('/proposals', {
    method: 'POST',
    body: {
      type: 'REFERENCE_MOVE',
      levelId,
      title: 'Stale Reference position move',
      reason: 'must fail after Reference changes',
      payload: { referenceId, target: { family: 'G', tier: 9, positionHint: -1 } },
    },
  })).payload.proposal

  await request(`/admin/references/${referenceId}`, {
    method: 'PATCH', body: { status: 'NEEDS_REVIEW', notes: 'intervening Reference change' },
  })
  const staleResult = await request(`/admin/proposals/${staleProposal.id}/decision`, {
    method: 'PATCH', body: { status: 'APPROVED', reason: 'should be stale' }, expectedStatus: 409,
  })
  if (!String(staleResult.payload?.error ?? '').includes('Reference proposal baseline is stale')) {
    throw new Error(`unexpected Reference stale guard: ${JSON.stringify(staleResult.payload)}`)
  }
  const staleStored = await db.query(`SELECT status,decided_at FROM proposals WHERE id=$1`, [staleProposal.id])
  if (staleStored.rows[0]?.status !== 'OPEN' || staleStored.rows[0]?.decided_at !== null) throw new Error('stale Reference proposal must remain OPEN')

  const removeProposal = (await request('/proposals', {
    method: 'POST',
    body: {
      type: 'REFERENCE_REMOVE',
      levelId,
      title: 'Retire TECH Reference',
      reason: 'Reference proposal remove E2E',
      payload: { referenceId },
    },
  })).payload.proposal
  if (removeProposal.payload?.baselineReference?.status !== 'NEEDS_REVIEW') throw new Error('REFERENCE_REMOVE did not capture current Reference baseline')

  const removeApproved = (await request(`/admin/proposals/${removeProposal.id}/decision`, {
    method: 'PATCH', body: { status: 'APPROVED', reason: 'approve remove' },
  })).payload
  if (removeApproved.execution?.type !== 'REFERENCE_REMOVE') throw new Error(`REFERENCE_REMOVE was not executed: ${JSON.stringify(removeApproved)}`)
  const removedRef = await db.query(`SELECT status FROM difficulty_references WHERE id=$1`, [referenceId])
  if (removedRef.rows[0]?.status !== 'RETIRED') throw new Error('approved REFERENCE_REMOVE must retire, not delete, the Reference')

  const history = await db.query(`SELECT action FROM reference_history WHERE reference_id=$1 ORDER BY created_at`, [referenceId])
  for (const action of ['PROPOSAL_ADD','PROPOSAL_MOVE','PROPOSAL_REMOVE']) {
    if (!history.rows.some((row) => row.action === action)) throw new Error(`${action} history entry missing`)
  }

  const executionAudits = await db.query(
    `SELECT count(*)::int AS count FROM audit_log WHERE actor_id=$1 AND action='PROPOSAL_EXECUTION' AND entity_id IN ($2,$3,$4)`,
    [userId, addProposal.id, moveProposal.id, removeProposal.id],
  )
  if (Number(executionAudits.rows[0]?.count) !== 3) throw new Error('expected three successful Reference proposal execution audits')

  const canonical = await db.query(`SELECT family,tier FROM canonical_ratings WHERE level_version_id=$1 AND effective_to IS NULL`, [versionId])
  if (canonical.rows[0]?.family !== 'G' || Number(canonical.rows[0]?.tier) !== 9) throw new Error('Reference proposals must not change canonical rating')

  console.log('REFERENCE PROPOSAL EXECUTION E2E PASSED')
  console.log('ADD -> ACTIVE; rerate -> NEEDS_REVIEW; MOVE -> new slot ACTIVE; stale guard -> 409 rollback; REMOVE -> RETIRED')
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
