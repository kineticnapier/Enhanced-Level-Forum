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

let connected = false
let userId = null
let levelId = null
const suffix = `${Date.now()}-${randomBytes(4).toString('hex')}`
const email = `elf-public-${suffix}@example.invalid`
const password = `elf-public-${randomBytes(16).toString('hex')}`

try {
  const health = await fetch(`${API_URL}/health`).catch(() => null)
  if (!health?.ok) throw new Error(`ELF API is not healthy at ${API_URL}. Start it with "npm run dev:api" first.`)
  await db.connect()
  connected = true

  const user = await db.query(
    `INSERT INTO users(email,display_name,role,password_hash)
     VALUES ($1,$2,'ADMIN',$3) RETURNING id`,
    [email, 'ELF public E2E', hashPassword(password)],
  )
  userId = user.rows[0].id

  const login = await request('/auth/login', { method: 'POST', body: { email, password }, authenticated: false })
  cookie = login.response.headers.get('set-cookie')?.split(';', 1)[0] ?? ''
  if (!cookie) throw new Error('login succeeded but no session cookie was returned')

  const created = (await request('/admin/levels', {
    method: 'POST',
    body: {
      song: `Public catalog song ${suffix}`,
      title: `Public catalog level ${suffix}`,
      creator: 'ELF public test runner',
      version: { label: 'Original' },
    },
  })).payload
  levelId = created.level.id
  const versionId = created.version.id

  await request(`/admin/levels/${levelId}/ratings`, {
    method: 'POST',
    body: { levelVersionId: versionId, family: 'G', tier: 8, confidence: 0.9, reason: 'public API baseline' },
  })
  const reference = (await request('/admin/references', {
    method: 'POST',
    body: { levelVersionId: versionId, family: 'G', tier: 8, technique: 'TECH', positionHint: 0, confidence: 0.8, notes: 'public E2E Reference' },
  })).payload.reference
  await request(`/levels/${levelId}/votes`, {
    method: 'POST',
    body: { family: 'G', anchorTier: 8, lean: 1, confidence: 4, comment: 'public E2E difficulty vote' },
  })

  const catalog = (await request(`/catalog/levels?search=${encodeURIComponent(suffix)}&family=G&tier=8&technique=TECH`)).payload
  if (catalog.total !== 1 || catalog.levels[0]?.id !== levelId || catalog.levels[0]?.referenceCount !== 1) {
    throw new Error(`catalog search mismatch: ${JSON.stringify(catalog)}`)
  }

  const level = (await request(`/catalog/levels/${levelId}`)).payload
  if (level.currentRating?.family !== 'G' || level.currentRating?.tier !== 8) throw new Error(`catalog detail rating mismatch: ${JSON.stringify(level.currentRating)}`)
  if (level.versions[0]?.currentRating?.tier !== 8) throw new Error('Version current rating missing from catalog detail')
  if (!level.ratingVotes.some((vote) => vote.comment === 'public E2E difficulty vote' && vote.lean === 1)) throw new Error('rating vote ledger missing from catalog detail')
  if (!level.references.some((row) => row.id === reference.id && row.versionLabel === 'Original')) throw new Error('Reference version metadata missing from catalog detail')

  const refs = (await request(`/catalog/references?search=${encodeURIComponent(suffix)}&family=G&tier=8&technique=TECH&status=ACTIVE`)).payload
  if (refs.total !== 1 || refs.references[0]?.id !== reference.id || refs.references[0]?.versionLabel !== 'Original') {
    throw new Error(`Reference catalog mismatch: ${JSON.stringify(refs)}`)
  }

  const proposal = (await request('/proposals', {
    method: 'POST',
    body: {
      type: 'RERATE',
      levelId,
      title: `Public rerate ${suffix}`,
      reason: 'Exercise public governance detail and stale inspection',
      payload: {
        targetLevelVersionId: versionId,
        currentCanonicalRating: { family: 'G', tier: 8 },
        proposedRating: { family: 'G', tier: 9 },
      },
    },
  })).payload.proposal

  const proposalList = (await request(`/governance/proposals?levelId=${levelId}&status=OPEN`)).payload
  const listed = proposalList.proposals.find((row) => row.id === proposal.id)
  if (!listed || listed.executionState !== 'READY') throw new Error(`proposal should be READY: ${JSON.stringify(listed)}`)

  await request(`/governance/proposals/${proposal.id}/vote`, { method: 'POST', body: { vote: 'AGREE' } })
  await request(`/governance/proposals/${proposal.id}/comments`, { method: 'POST', body: { body: 'Public governance E2E comment' } })

  const proposalDetail = (await request(`/governance/proposals/${proposal.id}`)).payload
  if (proposalDetail.proposal.myVote !== 'AGREE' || proposalDetail.proposal.agree !== 1) throw new Error(`my vote/count missing: ${JSON.stringify(proposalDetail.proposal)}`)
  if (!proposalDetail.votes.some((vote) => vote.userId === userId && vote.vote === 'AGREE')) throw new Error('voter ledger missing current user')
  if (!proposalDetail.comments.some((comment) => comment.body === 'Public governance E2E comment')) throw new Error('proposal comment missing')

  await request(`/admin/levels/${levelId}/ratings`, {
    method: 'POST',
    body: { levelVersionId: versionId, family: 'G', tier: 9, confidence: 0.8, reason: 'make proposal stale for UI inspection' },
  })
  const stale = (await request(`/governance/proposals/${proposal.id}`)).payload.proposal
  if (stale.executionState !== 'STALE') throw new Error(`proposal stale state not detected: ${JSON.stringify(stale)}`)

  await request(`/admin/proposals/${proposal.id}/decision`, {
    method: 'PATCH',
    body: { status: 'REJECTED', reason: 'close public E2E proposal' },
  })
  const closedVote = await request(`/governance/proposals/${proposal.id}/vote`, {
    method: 'POST',
    body: { vote: 'DISAGREE' },
    expectedStatus: 409,
  })
  if (!String(closedVote.payload?.error ?? '').includes('Voting is closed')) throw new Error(`closed voting guard mismatch: ${JSON.stringify(closedVote.payload)}`)

  console.log('PUBLIC GOVERNANCE E2E PASSED')
  console.log('catalog search/detail -> Reference filters -> proposal READY/stale inspection -> voter ledger -> comments -> closed-vote guard')
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
