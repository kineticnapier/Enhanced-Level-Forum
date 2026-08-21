import type { Context } from 'hono'
import type { Env } from './env'

export function jsonError(c: Context, status: number, message: string, details?: unknown) {
  return c.json({ error: message, details }, status as 400)
}

function safeDecodeCookieValue(value: string): string | null {
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}

export function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {}

  const cookies: Record<string, string> = {}
  for (const part of header.split(';')) {
    const index = part.indexOf('=')
    const name = (index < 0 ? part : part.slice(0, index)).trim()
    if (!name) continue

    const rawValue = index < 0 ? '' : part.slice(index + 1).trim()
    const decodedValue = safeDecodeCookieValue(rawValue)
    if (decodedValue === null) continue
    cookies[name] = decodedValue
  }
  return cookies
}

export function sessionCookieName(env: Env): string {
  return env.ENVIRONMENT === 'production' ? '__Host-elf_session' : 'elf_session'
}

export function sessionCookie(env: Env, token: string, maxAgeSeconds: number): string {
  const parts = [
    `${sessionCookieName(env)}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ]
  // __Host- cookies deliberately have no Domain attribute. This keeps the
  // session credential scoped to the API host instead of exposing it to sibling
  // public/admin subdomains.
  if (env.ENVIRONMENT === 'production') parts.push('Secure')
  return parts.join('; ')
}

export function clearSessionCookie(env: Env): string {
  return sessionCookie(env, '', 0)
}

export function allowedOrigin(env: Env, origin: string | undefined): string | null {
  if (!origin) return null
  const allowed = [env.WEB_ORIGIN, env.ADMIN_ORIGIN].filter(Boolean)
  return allowed.includes(origin) ? origin : null
}
