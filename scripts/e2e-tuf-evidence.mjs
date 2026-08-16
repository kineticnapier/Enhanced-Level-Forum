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
const snapshotIds = []
let connected = false
const suffix = `${Date.now()}-${randomBytes(4).toString('hex')}`
const email = `elf-tuf-evidence-${suffix}@example.invalid`
const password = `elf-tuf-evidence-${randomBytes(16).toString('hex')}`
const versionSha = randomBytes(32).toString('hex')
const tufExternalId = String(1_600_000_000 + (randomBytes(4).readUInt32BE(0) % 200_000_000))
const specialExternalId = String(Number(tufExternalId) + 1)

try {
  const health = await fetch(`${API_URL}/health`).catch(() => null)
  if (!health?.ok) throw new Error(`ELF API is not healthy at ${API_URL}. Start it with "npm run dev:api" first.`)
  await db.connect()
  connected = true

  const insertedUser = await db.query(
    `INSERT INTO users(email,display_name,role,password_hash)
     VALUES ($1,$2,'ADMIN',$3)
     RETURNING id`,
    [email, 'ELF TUF evidence E2E', hashPassword(password)],
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
      song: `TUF evidence target ${suffix}`,
      title: `TUF evidence target ${suffix}`,
      creator: 'ELF test runner',
      version: { label: 'Original', sha256: versionSha },
    },
  })).payload
  levelId = created.level.id
  const versionId = created.version.id

  await request(`/admin/levels/${levelId}/ratings`, {
    method: 'POST',
    body: { levelVersionId: versionId, family: 'G', tier: 8, confidence: 0.8, reason: 'TUF evidence E2E baseline' },
  })

  const canonicalBefore = await db.query(
    `SELECT id,family,tier,effective_to
     FROM canonical_ratings
     WHERE level_version_id=$1
     ORDER BY effective_from`,
    [versionId],
  )
  const referencesBefore = Number((await db.query(
    `SELECT count(*)::int AS count FROM difficulty_references WHERE level_version_id=$1`,
    [versionId],
  )).rows[0].count)

  const firstImport = (await request('/admin/imports/tuf', {
    method: 'POST',
    body: {
      sourceVersion: `tuf-evidence-first:${suffix}`,
      rawData: {
        fetchedAt: new Date().toISOString(),
        levels: [{
          id: Number(tufExternalId),
          song: `TUF evidence target ${suffix}`,
          charter: 'ELF test runner',
          difficulty: { name: 'G9' },
          sha256: versionSha,
        }],
        references: [{ difficulty: { name: 'G9' }, levels: [{ id: Number(tufExternalId), type: 'TECH' }] }],
      },
    },
  })).payload
  snapshotIds.push(firstImport.snapshot.id)
  if (firstImport.summary.autoLinkedBySha !== 1) throw new Error('first TUF evidence snapshot should auto-link by exact SHA')

  const secondImport = (await request('/admin/imports/tuf', {
    method: 'POST',
    body: {
      sourceVersion: `tuf-evidence-second:${suffix}`,
      rawData: {
        fetchedAt: new Date().toISOString(),
        levels: [
          {
            id: Number(tufExternalId),
            song: `TUF evidence target ${suffix}`,
            charter: 'ELF test runner',
            difficulty: { name: 'G10' },
            sha256: versionSha,
          },
          {
            id: Number(specialExternalId),
            song: `TUF special evidence ${suffix}`,
            charter: 'ELF test runner',
            difficulty: { name: 'Impossible' },
          },
        ],
        references: [{ difficulty: { name: 'G10' }, levels: [{ id: Number(tufExternalId), type: 'TECH' }] }],
      },
    },
  })).payload
  snapshotIds.push(secondImport.snapshot.id)

  const specialQueue = (await request(`/admin/imports/tuf/unlinked?snapshotId=${secondImport.snapshot.id}&search=${encodeURIComponent(specialExternalId)}`)).payload
  if (specialQueue.total !== 1) throw new Error(`expected special TUF row to be unlinked: ${JSON.stringify(specialQueue)}`)
  await request('/admin/imports/tuf/link', {
    method: 'POST',
    body: { observationId: specialQueue.rows[0].observationId, levelId },
  })

  const evidence = (await request(`/admin/imports/tuf/evidence?snapshotId=${secondImport.snapshot.id}&search=${encodeURIComponent(tufExternalId)}`)).payload
  if (evidence.total !== 1 || evidence.rows.length !== 1) {
    throw new Error(`expected one linked rating evidence row: ${JSON.stringify(evidence)}`)
  }
  const row = evidence.rows[0]
  if (row.tuf?.family !== 'G' || row.tuf?.tier !== 10 || row.elf?.family !== 'G' || row.elf?.tier !== 8) {
    throw new Error(`unexpected TUF/ELF comparison: ${JSON.stringify(row)}`)
  }
  if (row.previousTuf?.label !== 'G9' || row.changedSincePrevious !== true) {
    throw new Error(`previous TUF change was not detected: ${JSON.stringify(row.previousTuf)}`)
  }
  if (row.targetVersion?.id !== versionId || row.targetVersion?.linkBasis !== 'EXPLICIT_VERSION') {
    throw new Error(`expected exact version target from SHA linkage: ${JSON.stringify(row.targetVersion)}`)
  }
  if (!row.referenceEvidence.some((ref) => ref.type === 'TECH' && ref.family === 'G' && ref.tier === 10)) {
    throw new Error(`TUF Reference evidence missing: ${JSON.stringify(row.referenceEvidence)}`)
  }
  if (!row.proposalEligible || row.matchesCanonical || row.existingOpenProposalId) {
    throw new Error(`expected actionable TUF evidence before proposal creation: ${JSON.stringify(row)}`)
  }

  const actionable = (await request(`/admin/imports/tuf/evidence?snapshotId=${secondImport.snapshot.id}&actionableOnly=true`)).payload
  if (!actionable.rows.some((item) => item.externalId === tufExternalId)) {
    throw new Error('actionable-only evidence filter omitted the TUF/ELF rating difference')
  }
  if (actionable.rows.some((item) => item.externalId === specialExternalId)) {
    throw new Error('special/non-PGU evidence must not appear as an actionable canonical rerate')
  }

  const proposalResult = (await request('/admin/imports/tuf/proposals', {
    method: 'POST',
    body: { observationId: row.observationId, reason: 'E2E reviewer context' },
  })).payload
  const proposal = proposalResult.proposal
  if (proposal.type !== 'RERATE' || proposal.status !== 'OPEN') throw new Error(`unexpected proposal: ${JSON.stringify(proposal)}`)

  const storedProposal = await db.query(`SELECT * FROM proposals WHERE id=$1`, [proposal.id])
  const stored = storedProposal.rows[0]
  if (!stored) throw new Error('TUF evidence proposal was not stored')
  if (stored.level_id !== levelId || stored.payload?.source !== 'TUF' || stored.payload?.externalId !== tufExternalId) {
    throw new Error(`proposal source linkage is wrong: ${JSON.stringify(stored?.payload)}`)
  }
  if (stored.payload?.targetLevelVersionId !== versionId || stored.payload?.proposedRating?.family !== 'G' || stored.payload?.proposedRating?.tier !== 10) {
    throw new Error(`proposal target rating/version is wrong: ${JSON.stringify(stored.payload)}`)
  }
  if (stored.payload?.currentCanonicalRating?.family !== 'G' || stored.payload?.currentCanonicalRating?.tier !== 8) {
    throw new Error(`proposal did not preserve the ELF baseline rating: ${JSON.stringify(stored.payload)}`)
  }
  if (stored.payload?.previousTufRating?.label !== 'G9') {
    throw new Error(`proposal did not preserve previous TUF evidence: ${JSON.stringify(stored.payload)}`)
  }
  if (!stored.payload?.referenceEvidence?.some((ref) => ref.type === 'TECH')) {
    throw new Error(`proposal did not preserve Reference evidence: ${JSON.stringify(stored.payload)}`)
  }
  if (!String(stored.reason).includes('E2E reviewer context')) throw new Error('reviewer context was not appended to the generated evidence reason')

  const duplicate = await request('/admin/imports/tuf/proposals', {
    method: 'POST',
    body: { observationId: row.observationId },
    expectedStatus: 409,
  })
  if (!String(duplicate.payload?.error ?? '').includes('open proposal already covers')) {
    throw new Error(`duplicate proposal guard returned an unexpected response: ${JSON.stringify(duplicate.payload)}`)
  }

  const refreshed = (await request(`/admin/imports/tuf/evidence?snapshotId=${secondImport.snapshot.id}&search=${encodeURIComponent(tufExternalId)}`)).payload.rows[0]
  if (refreshed.existingOpenProposalId !== proposal.id || refreshed.proposalEligible !== false) {
    throw new Error(`evidence row did not expose the existing proposal: ${JSON.stringify(refreshed)}`)
  }

  const specialEvidence = (await request(`/admin/imports/tuf/evidence?snapshotId=${secondImport.snapshot.id}&search=${encodeURIComponent(specialExternalId)}`)).payload.rows[0]
  if (!specialEvidence || specialEvidence.tuf?.label !== 'Impossible' || specialEvidence.proposalEligible !== false) {
    throw new Error(`special TUF evidence was not preserved as non-actionable: ${JSON.stringify(specialEvidence)}`)
  }
  const specialProposal = await request('/admin/imports/tuf/proposals', {
    method: 'POST',
    body: { observationId: specialEvidence.observationId },
    expectedStatus: 400,
  })
  if (!String(specialProposal.payload?.error ?? '').includes('not a canonical P/G/U integer tier')) {
    throw new Error(`special difficulty proposal guard returned an unexpected response: ${JSON.stringify(specialProposal.payload)}`)
  }

  const canonicalAfter = await db.query(
    `SELECT id,family,tier,effective_to
     FROM canonical_ratings
     WHERE level_version_id=$1
     ORDER BY effective_from`,
    [versionId],
  )
  const referencesAfter = Number((await db.query(
    `SELECT count(*)::int AS count FROM difficulty_references WHERE level_version_id=$1`,
    [versionId],
  )).rows[0].count)
  if (JSON.stringify(canonicalAfter.rows) !== JSON.stringify(canonicalBefore.rows) || referencesAfter !== referencesBefore) {
    throw new Error('creating a TUF evidence proposal mutated canonical rating/reference tables')
  }

  const audit = await db.query(
    `SELECT action,details FROM audit_log
     WHERE actor_id=$1 AND action='PROPOSAL_CREATE' AND entity_id=$2`,
    [userId, proposal.id],
  )
  if (!audit.rowCount || audit.rows[0].details?.source !== 'TUF') {
    throw new Error('TUF evidence proposal audit entry missing')
  }

  console.log('TUF EVIDENCE PROPOSAL E2E PASSED')
  console.log('two snapshots -> rating change -> linked evidence -> Reference evidence -> RERATE proposal -> duplicate/special guards -> canonical unchanged')
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
