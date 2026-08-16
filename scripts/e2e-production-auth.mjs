import { createHash, pbkdf2Sync, randomBytes } from 'node:crypto'
import pg from 'pg'
import { resolveDatabaseUrl } from './local-env.mjs'

const { Client } = pg
const API_URL = (process.env.ELF_API_URL?.trim() || 'http://localhost:8787/api').replace(/\/$/, '')
const ORIGIN = process.env.ELF_E2E_ORIGIN?.trim() || 'http://localhost:5174'
const BAD_ORIGIN = 'https://csrf.invalid'
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

function rateEmailHash(email) {
  return createHash('sha256').update(`elf-development-rate-limit-salt\nemail\n${email.toLowerCase()}`).digest('hex')
}

async function request(path, { method = 'GET', body, cookie = '', origin = ORIGIN, expectedStatus = null } = {}) {
  const headers = {}
  if (origin !== null) headers.Origin = origin
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (cookie) headers.Cookie = cookie
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

async function login(email, password, expectedStatus = 200) {
  const result = await request('/auth/login', {
    method: 'POST',
    body: { email, password },
    expectedStatus,
  })
  const cookie = result.response.headers.get('set-cookie')?.split(';', 1)[0] ?? ''
  return { ...result, cookie }
}

const suffix = `${Date.now()}-${randomBytes(4).toString('hex')}`
const adminEmail = `elf-auth-admin-${suffix}@example.invalid`
const adminPassword = `Admin-${randomBytes(12).toString('hex')}!`
const targetEmail = `elf-auth-target-${suffix}@example.invalid`
const targetPassword = `Target-${randomBytes(12).toString('hex')}!`
const changedPassword = `Changed-${randomBytes(12).toString('hex')}!`
const resetPassword = `Reset-${randomBytes(12).toString('hex')}!`
const limitedEmail = `elf-auth-limit-${suffix}@example.invalid`
const limitedPassword = `Limit-${randomBytes(12).toString('hex')}!`

let connected = false
let adminId = null
let targetId = null
let limitedId = null

try {
  const health = await fetch(`${API_URL}/health`).catch(() => null)
  if (!health?.ok) throw new Error(`ELF API is not healthy at ${API_URL}. Start it with "npm run dev:api" first.`)

  await db.connect()
  connected = true

  const admin = await db.query(
    `INSERT INTO users(email,display_name,role,password_hash,is_active,password_changed_at)
     VALUES ($1,$2,'ADMIN',$3,true,now()) RETURNING id`,
    [adminEmail, 'ELF auth E2E admin', hashPassword(adminPassword)],
  )
  adminId = admin.rows[0].id

  const limited = await db.query(
    `INSERT INTO users(email,display_name,role,password_hash,is_active,password_changed_at)
     VALUES ($1,$2,'VIEWER',$3,true,now()) RETURNING id`,
    [limitedEmail, 'ELF auth E2E limited', hashPassword(limitedPassword)],
  )
  limitedId = limited.rows[0].id

  await request('/auth/login', {
    method: 'POST',
    origin: BAD_ORIGIN,
    body: { email: adminEmail, password: adminPassword },
    expectedStatus: 403,
  })

  for (let i = 0; i < 8; i++) {
    await login(limitedEmail, `wrong-${i}-${limitedPassword}`, 401)
  }
  await login(limitedEmail, limitedPassword, 429)

  const adminLogin = await login(adminEmail, adminPassword)
  const adminCookie = adminLogin.cookie
  if (!adminCookie.startsWith('elf_session=')) throw new Error(`development session cookie is unexpected: ${adminCookie}`)
  const setCookie = adminLogin.response.headers.get('set-cookie') ?? ''
  if (setCookie.toLowerCase().includes('domain=')) throw new Error(`session cookie must be host-only: ${setCookie}`)

  await request('/admin/users', {
    method: 'POST',
    cookie: adminCookie,
    body: { email: targetEmail, displayName: 'ELF auth E2E target', password: 'too-short', role: 'VIEWER' },
    expectedStatus: 400,
  })

  const created = await request('/admin/users', {
    method: 'POST',
    cookie: adminCookie,
    body: { email: targetEmail, displayName: 'ELF auth E2E target', password: targetPassword, role: 'VIEWER' },
    expectedStatus: 201,
  })
  targetId = created.payload.user.id

  const users = await request('/admin/users', { cookie: adminCookie })
  const targetRow = users.payload.users.find((row) => row.id === targetId)
  if (!targetRow || targetRow.isActive !== true || targetRow.role !== 'VIEWER') {
    throw new Error(`hardened user listing is wrong: ${JSON.stringify(targetRow)}`)
  }

  const targetLogin = await login(targetEmail, targetPassword)
  let targetCookie = targetLogin.cookie

  await request('/auth/change-password', {
    method: 'POST',
    cookie: targetCookie,
    body: { currentPassword: 'wrong-current', newPassword: changedPassword },
    expectedStatus: 401,
  })
  await request('/auth/change-password', {
    method: 'POST',
    cookie: targetCookie,
    body: { currentPassword: targetPassword, newPassword: changedPassword },
  })
  await login(targetEmail, targetPassword, 401)
  targetCookie = (await login(targetEmail, changedPassword)).cookie

  await request(`/admin/users/${targetId}/reset-password`, {
    method: 'POST',
    cookie: adminCookie,
    body: { password: resetPassword },
  })
  const invalidated = await request('/auth/me', { cookie: targetCookie })
  if (invalidated.payload.user !== null) throw new Error('admin password reset did not revoke existing sessions')
  targetCookie = (await login(targetEmail, resetPassword)).cookie

  await request(`/admin/users/${targetId}/status`, {
    method: 'PATCH',
    cookie: adminCookie,
    body: { isActive: false },
  })
  await login(targetEmail, resetPassword, 401)
  await request(`/admin/users/${targetId}/status`, {
    method: 'PATCH',
    cookie: adminCookie,
    body: { isActive: true },
  })
  targetCookie = (await login(targetEmail, resetPassword)).cookie

  await request(`/admin/users/${targetId}/role`, {
    method: 'PATCH',
    cookie: adminCookie,
    body: { role: 'RATER' },
  })
  const roleInvalidated = await request('/auth/me', { cookie: targetCookie })
  if (roleInvalidated.payload.user !== null) throw new Error('role change did not revoke existing sessions')
  const raterLogin = await login(targetEmail, resetPassword)
  targetCookie = raterLogin.cookie
  if (raterLogin.payload.user?.role !== 'RATER') throw new Error(`role change was not visible on re-login: ${JSON.stringify(raterLogin.payload)}`)

  await request('/auth/logout-all', { method: 'POST', cookie: targetCookie })
  const afterLogoutAll = await request('/auth/me', { cookie: targetCookie })
  if (afterLogoutAll.payload.user !== null) throw new Error('logout-all did not revoke the current session')

  const auditRows = await db.query(
    `SELECT action FROM audit_log WHERE actor_id=$1 OR entity_id=$2`,
    [adminId, targetId],
  )
  const actions = new Set(auditRows.rows.map((row) => row.action))
  for (const action of ['AUTH_LOGIN', 'USER_CREATE', 'PASSWORD_RESET', 'USER_STATUS', 'USER_ROLE']) {
    if (!actions.has(action)) throw new Error(`${action} audit entry missing`)
  }

  console.log('PRODUCTION AUTH E2E PASSED')
  console.log('origin guard -> login throttling -> strong user creation -> password change/reset -> session revocation -> disable/reactivate -> role revocation -> logout-all')
} finally {
  if (connected) {
    try {
      const ids = [adminId, targetId, limitedId].filter(Boolean)
      if (ids.length) {
        await db.query(
          `DELETE FROM audit_log WHERE actor_id=ANY($1::uuid[]) OR entity_id=ANY($2::text[])`,
          [ids, ids],
        )
        await db.query(`DELETE FROM users WHERE id=ANY($1::uuid[])`, [ids])
      }
      await db.query(`DELETE FROM auth_login_attempts WHERE email_hash=ANY($1::char(64)[])`, [
        [adminEmail, targetEmail, limitedEmail].map(rateEmailHash),
      ])
    } finally {
      await db.end()
    }
  }
}
