import type { Hono } from 'hono'
import type { SessionUser, UserRole } from '@elf/shared'
import { loadUser, requireRole, type AppBindings } from './auth'
import { hashPassword, randomToken, sha256Hex, verifyPassword } from './crypto'
import { inTransaction, withDb, type DbClient } from './db'
import type { Env } from './env'
import { allowedOrigin, clearSessionCookie, parseCookies, sessionCookie, sessionCookieName } from './http'
import { audit } from './services'

const USER_ROLES = new Set<UserRole>(['VIEWER', 'RATER', 'REFERENCE_MANAGER', 'MODERATOR', 'ADMIN'])
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const LOGIN_WINDOW_SQL = "interval '15 minutes'"
const LOGIN_EMAIL_FAILURE_LIMIT = 8
const LOGIN_IP_FAILURE_LIMIT = 30
const SESSION_SECONDS = 14 * 24 * 60 * 60
const DUMMY_PASSWORD_HASH = 'pbkdf2-sha256$210000$RUxGLURVTU1ZLVNBTFQhIQ$k0f4GOhibmKUTeEAo4q9tHGAL9zp-0Yj_FYfbcHYi5E'

class AuthAdminError extends Error {
  constructor(public status: 400 | 404 | 409, message: string) {
    super(message)
  }
}

function isProduction(env: Env): boolean {
  return env.ENVIRONMENT === 'production'
}

function passwordPolicyError(password: string): string | null {
  if (password.length < 12) return 'Password must be at least 12 characters.'
  if (password.length > 256) return 'Password must be at most 256 characters.'
  if (!password.trim()) return 'Password cannot be blank.'
  return null
}

function normalizedEmail(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? ''
}

function validEmail(value: string): boolean {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function clientIp(c: any): string {
  const direct = c.req.header('CF-Connecting-IP')?.trim()
  if (direct) return direct
  const forwarded = c.req.header('X-Forwarded-For')?.split(',')[0]?.trim()
  return forwarded || 'unknown'
}

async function rateLimitHashes(env: Env, email: string, ip: string) {
  const salt = env.AUTH_RATE_LIMIT_SALT?.trim() || (isProduction(env) ? '' : 'elf-development-rate-limit-salt')
  if (!salt) return null
  const [emailHash, ipHash] = await Promise.all([
    sha256Hex(`${salt}\nemail\n${email}`),
    sha256Hex(`${salt}\nip\n${ip}`),
  ])
  return { emailHash, ipHash }
}

async function loginIsRateLimited(db: DbClient, emailHash: string, ipHash: string): Promise<boolean> {
  const result = await db.query(
    `SELECT
       count(*) FILTER (WHERE email_hash=$1 AND success=false)::int AS email_failures,
       count(*) FILTER (WHERE ip_hash=$2 AND success=false)::int AS ip_failures
     FROM auth_login_attempts
     WHERE attempted_at > now() - ${LOGIN_WINDOW_SQL}`,
    [emailHash, ipHash],
  )
  const row = result.rows[0] ?? {}
  return Number(row.email_failures ?? 0) >= LOGIN_EMAIL_FAILURE_LIMIT
    || Number(row.ip_failures ?? 0) >= LOGIN_IP_FAILURE_LIMIT
}

async function recordLoginAttempt(db: DbClient, emailHash: string, ipHash: string, success: boolean) {
  await db.query(
    `INSERT INTO auth_login_attempts(email_hash,ip_hash,success) VALUES ($1,$2,$3)`,
    [emailHash, ipHash, success],
  )
  if (success) {
    await db.query(`DELETE FROM auth_login_attempts WHERE email_hash=$1 AND success=false`, [emailHash])
  }
  await db.query(`DELETE FROM auth_login_attempts WHERE attempted_at < now() - interval '24 hours'`)
}

function publicUser(row: any): SessionUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
  }
}

async function ensureAdminCanBeRemoved(db: DbClient, target: any, removingAdmin: boolean) {
  if (!removingAdmin || target.role !== 'ADMIN' || target.is_active !== true) return
  const remaining = await db.query(
    `SELECT count(*)::int AS count FROM users
     WHERE role='ADMIN' AND is_active=true AND id<>$1`,
    [target.id],
  )
  if (Number(remaining.rows[0]?.count ?? 0) < 1) {
    throw new AuthAdminError(409, 'Cannot remove or demote the final active ADMIN.')
  }
}

export function registerProductionAuth(app: Hono<AppBindings>) {
  // This middleware is registered before the legacy/core routes. It therefore
  // supplies CORS and browser-origin CSRF protection to both the hardened auth
  // routes below and the rest of the API mounted afterward.
  app.use('*', async (c, next) => {
    const origin = c.req.header('Origin')
    const allowed = allowedOrigin(c.env, origin)
    const path = new URL(c.req.url).pathname

    if (origin && !allowed && path.startsWith('/api/') && (c.req.method === 'OPTIONS' || UNSAFE_METHODS.has(c.req.method))) {
      return c.json({ error: 'Origin is not allowed' }, 403)
    }

    if (c.req.method === 'OPTIONS') {
      if (allowed) {
        c.header('Access-Control-Allow-Origin', allowed)
        c.header('Access-Control-Allow-Credentials', 'true')
        c.header('Access-Control-Allow-Headers', 'Content-Type')
        c.header('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS')
        c.header('Vary', 'Origin')
      }
      return c.body(null, 204)
    }

    await next()

    if (allowed) {
      c.header('Access-Control-Allow-Origin', allowed)
      c.header('Access-Control-Allow-Credentials', 'true')
      c.header('Vary', 'Origin')
    }
    c.header('X-Content-Type-Options', 'nosniff')
    c.header('Referrer-Policy', 'no-referrer')
    c.header('X-Frame-Options', 'DENY')
    if (path.startsWith('/api/auth/')) c.header('Cache-Control', 'no-store')
    if (isProduction(c.env)) c.header('Strict-Transport-Security', 'max-age=31536000')
  })

  // Registered before coreApp, so this hardened handler supersedes the old
  // development bootstrap login route without changing compatibility routes.
  app.post('/api/auth/login', async (c) => {
    const body = await c.req.json<{ email?: string; password?: string }>().catch((): { email?: string; password?: string } => ({}))
    const email = normalizedEmail(body.email)
    const password = body.password ?? ''
    if (!email || !password) return c.json({ error: 'Email and password are required' }, 400)

    const hashes = await rateLimitHashes(c.env, email, clientIp(c))
    if (!hashes) return c.json({ error: 'Production authentication is not configured: AUTH_RATE_LIMIT_SALT is missing.' }, 503)

    const result = await withDb(c.env, async (db) => {
      if (await loginIsRateLimited(db, hashes.emailHash, hashes.ipHash)) return { kind: 'limited' as const }

      let userResult = await db.query(
        `SELECT id,email,display_name,role,password_hash,is_active
         FROM users WHERE lower(email)=$1`,
        [email],
      )

      // Bootstrap credentials are intentionally development-only. Production
      // administrators are created out-of-band with scripts/create-admin.mjs.
      if (!userResult.rowCount
          && !isProduction(c.env)
          && c.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase() === email
          && c.env.BOOTSTRAP_ADMIN_PASSWORD === password) {
        const passwordHash = await hashPassword(password)
        userResult = await db.query(
          `INSERT INTO users(email,display_name,role,password_hash,is_active,password_changed_at)
           VALUES ($1,$2,'ADMIN',$3,true,now())
           RETURNING id,email,display_name,role,password_hash,is_active`,
          [email, email.split('@')[0] || 'admin', passwordHash],
        )
        await audit(db, userResult.rows[0].id, 'BOOTSTRAP_ADMIN', 'user', userResult.rows[0].id, { developmentOnly: true })
      }

      const row = userResult.rows[0] ?? null
      const validPassword = row
        ? await verifyPassword(password, row.password_hash)
        : await verifyPassword(password, DUMMY_PASSWORD_HASH)
      if (!row || !validPassword || row.is_active !== true) {
        await recordLoginAttempt(db, hashes.emailHash, hashes.ipHash, false)
        return { kind: 'invalid' as const }
      }

      await recordLoginAttempt(db, hashes.emailHash, hashes.ipHash, true)
      await db.query(`DELETE FROM sessions WHERE expires_at<=now()`)
      const token = randomToken()
      const tokenHash = await sha256Hex(token)
      await db.query(
        `INSERT INTO sessions(user_id,token_hash,expires_at)
         VALUES ($1,$2,now()+interval '14 days')`,
        [row.id, tokenHash],
      )
      await db.query(`UPDATE users SET last_login_at=now(),updated_at=now() WHERE id=$1`, [row.id])
      await audit(db, row.id, 'AUTH_LOGIN', 'user', row.id, { method: 'password' })
      return { kind: 'ok' as const, token, user: publicUser(row) }
    })

    if (result.kind === 'limited') {
      c.header('Retry-After', '60')
      return c.json({ error: 'Too many failed login attempts. Try again later.' }, 429)
    }
    if (result.kind === 'invalid') return c.json({ error: 'Invalid credentials' }, 401)
    c.header('Set-Cookie', sessionCookie(c.env, result.token, SESSION_SECONDS))
    return c.json({ user: result.user })
  })

  app.post('/api/auth/logout', async (c) => {
    const token = parseCookies(c.req.header('Cookie'))[sessionCookieName(c.env)]
    if (token) {
      const tokenHash = await sha256Hex(token)
      await withDb(c.env, async (db) => {
        const session = await db.query(`SELECT user_id FROM sessions WHERE token_hash=$1`, [tokenHash])
        await db.query(`DELETE FROM sessions WHERE token_hash=$1`, [tokenHash])
        if (session.rowCount) await audit(db, session.rows[0].user_id, 'AUTH_LOGOUT', 'user', session.rows[0].user_id, {})
      }).catch(() => undefined)
    }
    c.header('Set-Cookie', clearSessionCookie(c.env))
    return c.json({ ok: true })
  })

  app.post('/api/auth/logout-all', loadUser, async (c) => {
    const user = c.get('user')
    if (!user) return c.json({ error: 'Authentication required' }, 401)
    await withDb(c.env, async (db) => {
      await db.query(`DELETE FROM sessions WHERE user_id=$1`, [user.id])
      await audit(db, user.id, 'AUTH_LOGOUT_ALL', 'user', user.id, {})
    })
    c.header('Set-Cookie', clearSessionCookie(c.env))
    return c.json({ ok: true })
  })

  app.post('/api/auth/change-password', loadUser, async (c) => {
    const user = c.get('user')
    if (!user) return c.json({ error: 'Authentication required' }, 401)
    const body = await c.req.json<{ currentPassword?: string; newPassword?: string }>().catch((): { currentPassword?: string; newPassword?: string } => ({}))
    const currentPassword = body.currentPassword ?? ''
    const newPassword = body.newPassword ?? ''
    const policyError = passwordPolicyError(newPassword)
    if (!currentPassword || policyError) return c.json({ error: policyError ?? 'Current password is required.' }, 400)
    if (currentPassword === newPassword) return c.json({ error: 'New password must be different from the current password.' }, 400)

    const token = parseCookies(c.req.header('Cookie'))[sessionCookieName(c.env)]
    if (!token) return c.json({ error: 'Authentication required' }, 401)
    const currentTokenHash = await sha256Hex(token)

    const changed = await withDb(c.env, async (db) => inTransaction(db, async () => {
      const row = await db.query(`SELECT password_hash FROM users WHERE id=$1 AND is_active=true FOR UPDATE`, [user.id])
      if (!row.rowCount || !await verifyPassword(currentPassword, row.rows[0].password_hash)) return false
      const passwordHash = await hashPassword(newPassword)
      await db.query(
        `UPDATE users SET password_hash=$2,password_changed_at=now(),updated_at=now() WHERE id=$1`,
        [user.id, passwordHash],
      )
      await db.query(`DELETE FROM sessions WHERE user_id=$1 AND token_hash<>$2`, [user.id, currentTokenHash])
      await audit(db, user.id, 'PASSWORD_CHANGE', 'user', user.id, { otherSessionsRevoked: true })
      return true
    }))
    if (!changed) return c.json({ error: 'Current password is incorrect.' }, 401)
    return c.json({ ok: true, otherSessionsRevoked: true })
  })

  // Harden the existing ADMIN user-management surface. These exact routes are
  // registered before coreApp, so callers keep the same URLs while receiving
  // active-account, last-admin and session-revocation guarantees.
  app.get('/api/admin/users', loadUser, requireRole('ADMIN'), async (c) => {
    const users = await withDb(c.env, async (db) => {
      const result = await db.query(
        `SELECT id,email,display_name,role,is_active,password_changed_at,last_login_at,created_at,updated_at
         FROM users ORDER BY created_at`,
      )
      return result.rows.map((row) => ({
        id: row.id,
        email: row.email,
        displayName: row.display_name,
        role: row.role,
        isActive: row.is_active,
        passwordChangedAt: row.password_changed_at,
        lastLoginAt: row.last_login_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }))
    })
    return c.json({ users })
  })

  app.post('/api/admin/users', loadUser, requireRole('ADMIN'), async (c) => {
    const actor = c.get('user')!
    const body = await c.req.json<{ email?: string; displayName?: string; password?: string; role?: UserRole }>().catch((): { email?: string; displayName?: string; password?: string; role?: UserRole } => ({}))
    const email = normalizedEmail(body.email)
    const displayName = body.displayName?.trim() ?? ''
    const password = body.password ?? ''
    const role = body.role
    if (!validEmail(email) || !displayName || displayName.length > 80 || !role || !USER_ROLES.has(role)) {
      return c.json({ error: 'Valid email, displayName (1..80), password, and role are required.' }, 400)
    }
    const policyError = passwordPolicyError(password)
    if (policyError) return c.json({ error: policyError }, 400)

    try {
      const user = await withDb(c.env, async (db) => {
        const passwordHash = await hashPassword(password)
        const result = await db.query(
          `INSERT INTO users(email,display_name,role,password_hash,is_active,password_changed_at)
           VALUES ($1,$2,$3,$4,true,now())
           RETURNING id,email,display_name,role,is_active,created_at`,
          [email, displayName, role, passwordHash],
        )
        await audit(db, actor.id, 'USER_CREATE', 'user', result.rows[0].id, { role })
        return result.rows[0]
      })
      return c.json({ user }, 201)
    } catch (error: any) {
      if (error?.code === '23505') return c.json({ error: 'A user with that email already exists.' }, 409)
      throw error
    }
  })

  app.patch('/api/admin/users/:id/role', loadUser, requireRole('ADMIN'), async (c) => {
    const actor = c.get('user')!
    const body = await c.req.json<{ role?: UserRole }>().catch((): { role?: UserRole } => ({}))
    if (!body.role || !USER_ROLES.has(body.role)) return c.json({ error: 'Invalid role' }, 400)
    try {
      const user = await withDb(c.env, async (db) => inTransaction(db, async () => {
        const targetResult = await db.query(`SELECT * FROM users WHERE id=$1 FOR UPDATE`, [c.req.param('id')])
        if (!targetResult.rowCount) throw new AuthAdminError(404, 'User not found')
        const target = targetResult.rows[0]
        await ensureAdminCanBeRemoved(db, target, body.role !== 'ADMIN')
        const updated = await db.query(
          `UPDATE users SET role=$2,updated_at=now() WHERE id=$1
           RETURNING id,email,display_name,role,is_active`,
          [target.id, body.role],
        )
        if (target.role !== body.role) await db.query(`DELETE FROM sessions WHERE user_id=$1`, [target.id])
        await audit(db, actor.id, 'USER_ROLE', 'user', target.id, { from: target.role, to: body.role, sessionsRevoked: target.role !== body.role })
        return updated.rows[0]
      }))
      return c.json({ user })
    } catch (error) {
      if (error instanceof AuthAdminError) return c.json({ error: error.message }, error.status)
      throw error
    }
  })

  app.patch('/api/admin/users/:id/status', loadUser, requireRole('ADMIN'), async (c) => {
    const actor = c.get('user')!
    const body = await c.req.json<{ isActive?: boolean }>().catch((): { isActive?: boolean } => ({}))
    if (typeof body.isActive !== 'boolean') return c.json({ error: 'isActive boolean is required' }, 400)
    try {
      const user = await withDb(c.env, async (db) => inTransaction(db, async () => {
        const targetResult = await db.query(`SELECT * FROM users WHERE id=$1 FOR UPDATE`, [c.req.param('id')])
        if (!targetResult.rowCount) throw new AuthAdminError(404, 'User not found')
        const target = targetResult.rows[0]
        await ensureAdminCanBeRemoved(db, target, body.isActive === false)
        const updated = await db.query(
          `UPDATE users SET is_active=$2,updated_at=now() WHERE id=$1
           RETURNING id,email,display_name,role,is_active`,
          [target.id, body.isActive],
        )
        if (!body.isActive) await db.query(`DELETE FROM sessions WHERE user_id=$1`, [target.id])
        await audit(db, actor.id, 'USER_STATUS', 'user', target.id, { from: target.is_active, to: body.isActive, sessionsRevoked: !body.isActive })
        return updated.rows[0]
      }))
      return c.json({ user })
    } catch (error) {
      if (error instanceof AuthAdminError) return c.json({ error: error.message }, error.status)
      throw error
    }
  })

  app.post('/api/admin/users/:id/reset-password', loadUser, requireRole('ADMIN'), async (c) => {
    const actor = c.get('user')!
    const body = await c.req.json<{ password?: string }>().catch((): { password?: string } => ({}))
    const password = body.password ?? ''
    const policyError = passwordPolicyError(password)
    if (policyError) return c.json({ error: policyError }, 400)
    const passwordHash = await hashPassword(password)
    const reset = await withDb(c.env, async (db) => inTransaction(db, async () => {
      const target = await db.query(`SELECT id FROM users WHERE id=$1 FOR UPDATE`, [c.req.param('id')])
      if (!target.rowCount) return false
      await db.query(
        `UPDATE users SET password_hash=$2,password_changed_at=now(),updated_at=now() WHERE id=$1`,
        [c.req.param('id'), passwordHash],
      )
      await db.query(`DELETE FROM sessions WHERE user_id=$1`, [c.req.param('id')])
      await audit(db, actor.id, 'PASSWORD_RESET', 'user', c.req.param('id'), { sessionsRevoked: true })
      return true
    }))
    if (!reset) return c.json({ error: 'User not found' }, 404)
    return c.json({ ok: true, sessionsRevoked: true })
  })
}
