import type { Context } from 'hono'
import type { Env } from './env'

export function jsonError(c: Context, status: number, message: string, details?: unknown) {
  return c.json({ error: message, details }, status as 400)
}

export function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {}
  return Object.fromEntries(
    header.split(';').map((part) => {
      const index = part.indexOf('=')
      if (index < 0) return [part.trim(), '']
      return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())]
    }),
  )
}

export function sessionCookie(env: Env, token: string, maxAgeSeconds: number): string {
  const parts = [
    `elf_session=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ]
  if (env.ENVIRONMENT !== 'development') parts.push('Secure')
  if (env.COOKIE_DOMAIN) parts.push(`Domain=${env.COOKIE_DOMAIN}`)
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
