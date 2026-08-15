import type { MiddlewareHandler } from 'hono'
import type { SessionUser, UserRole } from '@adoforum/shared'
import { withDb } from './db'
import type { Env } from './env'
import { parseCookies } from './http'
import { sha256Hex } from './crypto'

type Variables = { user: SessionUser | null }
export type AppBindings = { Bindings: Env; Variables: Variables }

const roleRank: Record<UserRole, number> = {
  VIEWER: 0,
  RATER: 1,
  REFERENCE_MANAGER: 2,
  MODERATOR: 3,
  ADMIN: 4,
}

export function hasRole(user: SessionUser | null, minimum: UserRole): boolean {
  return !!user && roleRank[user.role] >= roleRank[minimum]
}

export const loadUser: MiddlewareHandler<AppBindings> = async (c, next) => {
  const token = parseCookies(c.req.header('Cookie')).adoforum_session
  if (!token) {
    c.set('user', null)
    return next()
  }
  const tokenHash = await sha256Hex(token)
  const user = await withDb(c.env, async (db) => {
    const result = await db.query(
      `SELECT u.id, u.email, u.display_name, u.role
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.expires_at > now()`,
      [tokenHash],
    )
    if (!result.rowCount) return null
    const row = result.rows[0]
    return {
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      role: row.role,
    } as SessionUser
  })
  c.set('user', user)
  return next()
}

export function requireRole(minimum: UserRole): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    const user = c.get('user')
    if (!user) return c.json({ error: 'Authentication required' }, 401)
    if (!hasRole(user, minimum)) return c.json({ error: `Requires ${minimum} role` }, 403)
    return next()
  }
}
