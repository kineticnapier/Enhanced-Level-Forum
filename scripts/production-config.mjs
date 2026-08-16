import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseEnvText, ROOT_DIR } from './local-env.mjs'

const PRODUCTION_ENV = resolve(ROOT_DIR, '.env.production')

async function readProductionFile() {
  try {
    return parseEnvText(await readFile(PRODUCTION_ENV, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return {}
    throw error
  }
}

function value(fileEnv, name) {
  return process.env[name]?.trim() || fileEnv[name]?.trim() || ''
}

function productionOrigin(raw, name) {
  let url
  try { url = new URL(raw) } catch { throw new Error(`${name} must be a valid absolute URL.`) }
  if (url.protocol !== 'https:') throw new Error(`${name} must use https:// in production.`)
  if (url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
    throw new Error(`${name} must be an origin only (no path, query, fragment, or credentials).`)
  }
  return url.origin
}

function validateDatabaseUrl(raw) {
  let url
  try { url = new URL(raw) } catch { throw new Error('DATABASE_URL must be a valid PostgreSQL URL.') }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('DATABASE_URL must use postgres:// or postgresql://.')
  if (!url.hostname || !url.pathname.replace(/^\//, '')) throw new Error('DATABASE_URL must include a host and database name.')
  return raw
}

function siblingBase(hostname) {
  const parts = hostname.split('.')
  return parts.length >= 3 ? parts.slice(1).join('.') : hostname
}

export async function loadProductionConfig({ requireHyperdrive = false, requireSecrets = false, requireAdmin = false } = {}) {
  const fileEnv = await readProductionFile()
  const publicOrigin = productionOrigin(value(fileEnv, 'ELF_PUBLIC_ORIGIN'), 'ELF_PUBLIC_ORIGIN')
  const adminOrigin = productionOrigin(value(fileEnv, 'ELF_ADMIN_ORIGIN'), 'ELF_ADMIN_ORIGIN')
  const apiOrigin = productionOrigin(value(fileEnv, 'ELF_API_ORIGIN'), 'ELF_API_ORIGIN')
  const origins = [new URL(publicOrigin), new URL(adminOrigin), new URL(apiOrigin)]
  const bases = new Set(origins.map((x) => siblingBase(x.hostname)))
  if (bases.size !== 1) {
    throw new Error('ELF_PUBLIC_ORIGIN, ELF_ADMIN_ORIGIN, and ELF_API_ORIGIN must be sibling HTTPS hosts under the same site so SameSite=Lax auth works.')
  }

  const databaseUrlRaw = value(fileEnv, 'DATABASE_URL')
  const databaseUrl = databaseUrlRaw ? validateDatabaseUrl(databaseUrlRaw) : ''
  const hyperdriveId = value(fileEnv, 'ELF_HYPERDRIVE_ID')
  const hyperdriveName = value(fileEnv, 'ELF_HYPERDRIVE_NAME') || 'enhanced-level-forum-db'
  const authRateLimitSalt = value(fileEnv, 'AUTH_RATE_LIMIT_SALT')
  const adminEmail = value(fileEnv, 'ELF_ADMIN_EMAIL').toLowerCase()
  const adminName = value(fileEnv, 'ELF_ADMIN_NAME') || 'ELF Administrator'
  const adminPassword = value(fileEnv, 'ELF_ADMIN_PASSWORD')

  if (requireHyperdrive && !hyperdriveId) throw new Error('ELF_HYPERDRIVE_ID is required. Run npm run production:setup first.')
  if (hyperdriveId && !/^[A-Za-z0-9_-]{8,}$/.test(hyperdriveId)) throw new Error('ELF_HYPERDRIVE_ID does not look valid.')
  if (requireSecrets && authRateLimitSalt.length < 32) throw new Error('AUTH_RATE_LIMIT_SALT must be at least 32 characters.')
  if (requireAdmin) {
    if (!databaseUrl) throw new Error('DATABASE_URL is required to create the production ADMIN.')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) throw new Error('ELF_ADMIN_EMAIL must be a valid email address.')
    if (adminPassword.length < 12) throw new Error('ELF_ADMIN_PASSWORD must be at least 12 characters.')
  }

  return {
    publicOrigin, adminOrigin, apiOrigin, databaseUrl, hyperdriveId, hyperdriveName,
    authRateLimitSalt, adminEmail, adminName, adminPassword,
  }
}

export function redactDatabaseUrl(value) {
  if (!value) return '(not set)'
  try {
    const url = new URL(value)
    if (url.password) url.password = '***'
    return url.toString()
  } catch { return '(invalid)' }
}

export async function writeProductionWranglerConfigs(config) {
  if (!config.hyperdriveId) throw new Error('Cannot generate Wrangler config without ELF_HYPERDRIVE_ID.')
  const apiHost = new URL(config.apiOrigin).hostname
  const webHost = new URL(config.publicOrigin).hostname
  const adminHost = new URL(config.adminOrigin).hostname

  const api = {
    $schema: 'node_modules/wrangler/config-schema.json',
    name: 'enhanced-level-forum-api',
    main: 'src/entry.ts',
    compatibility_date: '2026-08-14',
    compatibility_flags: ['nodejs_compat'],
    workers_dev: false,
    routes: [{ pattern: apiHost, custom_domain: true }],
    vars: {
      ENVIRONMENT: 'production',
      WEB_ORIGIN: config.publicOrigin,
      ADMIN_ORIGIN: config.adminOrigin,
    },
    secrets: { required: ['AUTH_RATE_LIMIT_SALT'] },
    hyperdrive: [{ binding: 'HYPERDRIVE', id: config.hyperdriveId }],
    observability: { enabled: true },
  }
  const staticWorker = (name, host) => ({
    $schema: 'node_modules/wrangler/config-schema.json',
    name,
    compatibility_date: '2026-08-14',
    workers_dev: false,
    routes: [{ pattern: host, custom_domain: true }],
    assets: { directory: './dist', not_found_handling: 'single-page-application' },
  })

  await Promise.all([
    writeFile(resolve(ROOT_DIR, 'apps/api/wrangler.production.generated.json'), `${JSON.stringify(api, null, 2)}\n`, 'utf8'),
    writeFile(resolve(ROOT_DIR, 'apps/web/wrangler.production.generated.json'), `${JSON.stringify(staticWorker('enhanced-level-forum-web', webHost), null, 2)}\n`, 'utf8'),
    writeFile(resolve(ROOT_DIR, 'apps/admin/wrangler.production.generated.json'), `${JSON.stringify(staticWorker('enhanced-level-forum-admin', adminHost), null, 2)}\n`, 'utf8'),
  ])
}

export async function writeApiSecretsFile(config) {
  if (config.authRateLimitSalt.length < 32) throw new Error('AUTH_RATE_LIMIT_SALT must be at least 32 characters.')
  const path = resolve(ROOT_DIR, 'apps/api/.wrangler-production-secrets.json')
  await writeFile(path, `${JSON.stringify({ AUTH_RATE_LIMIT_SALT: config.authRateLimitSalt })}\n`, { encoding: 'utf8', mode: 0o600 })
  return path
}

export async function persistHyperdriveId(id) {
  const fileEnv = await readProductionFile()
  fileEnv.ELF_HYPERDRIVE_ID = id
  const preferred = [
    'ELF_PUBLIC_ORIGIN','ELF_ADMIN_ORIGIN','ELF_API_ORIGIN','DATABASE_URL','ELF_HYPERDRIVE_ID','ELF_HYPERDRIVE_NAME',
    'AUTH_RATE_LIMIT_SALT','ELF_ADMIN_EMAIL','ELF_ADMIN_NAME','ELF_ADMIN_PASSWORD',
  ]
  const lines = preferred.filter((key) => key in fileEnv).map((key) => `${key}=${fileEnv[key] ?? ''}`)
  for (const [key, val] of Object.entries(fileEnv)) if (!preferred.includes(key)) lines.push(`${key}=${val}`)
  await writeFile(PRODUCTION_ENV, `${lines.join('\n')}\n`, 'utf8')
}
