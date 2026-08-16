import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { ROOT_DIR } from './local-env.mjs'

const read = (path) => readFile(resolve(ROOT_DIR, path), 'utf8')
const [auth, http, entry, migration, createAdmin, wrangler] = await Promise.all([
  read('apps/api/src/production-auth.ts'),
  read('apps/api/src/http.ts'),
  read('apps/api/src/entry.ts'),
  read('db/migrations/004_auth_hardening.sql'),
  read('scripts/create-admin.mjs'),
  read('apps/api/wrangler.jsonc'),
])

const checks = [
  [auth.includes('AUTH_RATE_LIMIT_SALT'), 'login rate-limit salt is wired'],
  [auth.includes('Too many failed login attempts'), 'login throttling response exists'],
  [auth.includes("c.env.BOOTSTRAP_ADMIN_EMAIL") && auth.includes('!isProduction(c.env)'), 'bootstrap login is development-only'],
  [auth.includes('Cannot remove or demote the final active ADMIN'), 'last-active-admin guard exists'],
  [auth.includes('DELETE FROM sessions WHERE user_id=$1'), 'security-sensitive user changes revoke sessions'],
  [auth.includes('Origin is not allowed'), 'browser origin guard exists'],
  [http.includes('__Host-elf_session'), 'production cookie uses __Host- prefix'],
  [!http.includes('Domain='), 'session cookie implementation does not set Domain'],
  [entry.includes('registerProductionAuth(app)') && entry.indexOf('registerProductionAuth(app)') < entry.indexOf("app.route('/', coreApp)"), 'hardened auth is mounted before compatibility routes'],
  [migration.includes('auth_login_attempts') && migration.includes('is_active boolean'), 'auth hardening migration exists'],
  [createAdmin.includes('ELF_ADMIN_PASSWORD') && !createAdmin.includes("argument('--password')"), 'production admin script keeps password out of argv'],
  [!wrangler.includes('COOKIE_DOMAIN'), 'Wrangler config no longer asks for shared-domain session cookies'],
]

const failed = checks.filter(([ok]) => !ok)
for (const [ok, label] of checks) console.log(`${ok ? 'OK' : 'FAIL'} ${label}`)
if (failed.length) process.exit(1)
console.log('PRODUCTION AUTH STATIC SMOKE PASSED')
