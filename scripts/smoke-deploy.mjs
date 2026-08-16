import { readFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { ROOT_DIR } from './local-env.mjs'

const touchedKeys = [
  'ELF_DEPLOY_MODE','ELF_WORKERS_DEV_SUBDOMAIN','ELF_PUBLIC_ORIGIN','ELF_ADMIN_ORIGIN','ELF_API_ORIGIN',
  'DATABASE_URL','ELF_HYPERDRIVE_ID','AUTH_RATE_LIMIT_SALT',
]
const saved = Object.fromEntries(touchedKeys.map((key) => [key, process.env[key]]))

function setEnv(values) {
  for (const key of touchedKeys) delete process.env[key]
  Object.assign(process.env, values)
}

async function readGenerated() {
  const apiPath = resolve(ROOT_DIR, 'apps/api/wrangler.production.generated.json')
  const webPath = resolve(ROOT_DIR, 'apps/web/wrangler.production.generated.json')
  const adminPath = resolve(ROOT_DIR, 'apps/admin/wrangler.production.generated.json')
  const [api, web, admin] = await Promise.all([
    readFile(apiPath, 'utf8').then(JSON.parse),
    readFile(webPath, 'utf8').then(JSON.parse),
    readFile(adminPath, 'utf8').then(JSON.parse),
  ])
  return { api, web, admin }
}

try {
  const { loadProductionConfig, writeProductionWranglerConfigs } = await import('./production-config.mjs')
  const common = {
    DATABASE_URL: 'postgres://user:password@db.example.net:5432/adoforum?sslmode=require',
    ELF_HYPERDRIVE_ID: '0123456789abcdef0123456789abcdef',
    AUTH_RATE_LIMIT_SALT: 'static-smoke-only-rate-limit-salt-0123456789',
  }
  const expectedWorkersOrigins = {
    public: 'https://enhanced-level-forum-web.elf-test-account.workers.dev',
    admin: 'https://enhanced-level-forum-admin.elf-test-account.workers.dev',
    api: 'https://enhanced-level-forum-api.elf-test-account.workers.dev',
  }

  // Explicitly provide the derived values too, so an unrelated local
  // .env.production cannot leak custom-domain origins into this static test.
  setEnv({
    ...common,
    ELF_DEPLOY_MODE: 'workers_dev',
    ELF_WORKERS_DEV_SUBDOMAIN: 'elf-test-account',
    ELF_PUBLIC_ORIGIN: expectedWorkersOrigins.public,
    ELF_ADMIN_ORIGIN: expectedWorkersOrigins.admin,
    ELF_API_ORIGIN: expectedWorkersOrigins.api,
  })
  const workersConfig = await loadProductionConfig({ requireHyperdrive: true, requireSecrets: true })
  await writeProductionWranglerConfigs(workersConfig)
  const workers = await readGenerated()

  if (workersConfig.publicOrigin !== expectedWorkersOrigins.public || workersConfig.adminOrigin !== expectedWorkersOrigins.admin || workersConfig.apiOrigin !== expectedWorkersOrigins.api) {
    throw new Error('workers.dev origins were not derived from account subdomain')
  }
  if (workers.api.vars?.WEB_ORIGIN !== expectedWorkersOrigins.public || workers.api.vars?.ADMIN_ORIGIN !== expectedWorkersOrigins.admin) throw new Error('workers.dev API origins wrong')
  if (workers.api.main !== 'src/worker.ts') throw new Error('production API must use fetch+scheduled Worker entrypoint')
  if (JSON.stringify(workers.api.triggers?.crons) !== JSON.stringify(['17 * * * *'])) throw new Error('production TUF Cron Trigger missing')
  if (workers.api.workers_dev !== true || workers.web.workers_dev !== true || workers.admin.workers_dev !== true) throw new Error('workers.dev mode should enable workers_dev')
  if ('routes' in workers.api || 'routes' in workers.web || 'routes' in workers.admin) throw new Error('workers.dev mode must not emit custom-domain routes')
  if (workers.api.preview_urls !== false || workers.web.preview_urls !== false || workers.admin.preview_urls !== false) throw new Error('production preview URLs should stay disabled')

  setEnv({
    ...common,
    ELF_DEPLOY_MODE: 'custom_domain',
    ELF_PUBLIC_ORIGIN: 'https://forum.example.com',
    ELF_ADMIN_ORIGIN: 'https://admin.example.com',
    ELF_API_ORIGIN: 'https://api.example.com',
  })
  const customConfig = await loadProductionConfig({ requireHyperdrive: true, requireSecrets: true })
  await writeProductionWranglerConfigs(customConfig)
  const custom = await readGenerated()

  if (custom.api.vars?.ENVIRONMENT !== 'production') throw new Error('API production ENVIRONMENT missing')
  if (custom.api.vars?.WEB_ORIGIN !== 'https://forum.example.com' || custom.api.vars?.ADMIN_ORIGIN !== 'https://admin.example.com') throw new Error('custom-domain API origins wrong')
  if (custom.api.hyperdrive?.[0]?.binding !== 'HYPERDRIVE' || custom.api.hyperdrive?.[0]?.id !== common.ELF_HYPERDRIVE_ID) throw new Error('Hyperdrive binding wrong')
  if (!custom.api.secrets?.required?.includes('AUTH_RATE_LIMIT_SALT')) throw new Error('required Worker secret declaration missing')
  if (JSON.stringify(custom.api.triggers?.crons) !== JSON.stringify(['17 * * * *'])) throw new Error('custom-domain production TUF Cron Trigger missing')
  if (custom.api.routes?.[0]?.pattern !== 'api.example.com' || custom.api.routes?.[0]?.custom_domain !== true) throw new Error('API custom domain wrong')
  if (custom.api.workers_dev !== false || custom.web.workers_dev !== false || custom.admin.workers_dev !== false) throw new Error('custom-domain mode should disable workers.dev')
  if (custom.web.assets?.not_found_handling !== 'single-page-application' || custom.admin.assets?.not_found_handling !== 'single-page-application') throw new Error('SPA static asset routing missing')
  if (custom.web.routes?.[0]?.pattern !== 'forum.example.com' || custom.admin.routes?.[0]?.pattern !== 'admin.example.com') throw new Error('frontend custom domains wrong')

  const setupSource = await readFile(resolve(ROOT_DIR, 'scripts/setup-production.mjs'), 'utf8')
  const deploySource = await readFile(resolve(ROOT_DIR, 'scripts/deploy-production.mjs'), 'utf8')
  const smokeSource = await readFile(resolve(ROOT_DIR, 'scripts/smoke-production.mjs'), 'utf8')
  for (const needle of ['hyperdrive', 'apply-migrations', 'create-admin']) if (!setupSource.includes(needle)) throw new Error(`production setup missing ${needle}`)
  for (const needle of ['--secrets-file', 'VITE_API_URL', 'wrangler.production.generated.json']) if (!deploySource.includes(needle)) throw new Error(`production deploy missing ${needle}`)
  for (const needle of ['__Host-elf_session', 'access-control-allow-origin', 'PRODUCTION DEPLOY SMOKE PASSED']) if (!smokeSource.includes(needle)) throw new Error(`production live smoke missing ${needle}`)

  console.log('CLOUDFLARE PRODUCTION DEPLOY STATIC SMOKE PASSED')
  console.log('workers.dev bootstrap mode -> later custom-domain mode + hourly TUF Cron')
} finally {
  for (const [key, previous] of Object.entries(saved)) {
    if (previous === undefined) delete process.env[key]
    else process.env[key] = previous
  }
  await Promise.all([
    rm(resolve(ROOT_DIR, 'apps/api/wrangler.production.generated.json'), { force: true }),
    rm(resolve(ROOT_DIR, 'apps/web/wrangler.production.generated.json'), { force: true }),
    rm(resolve(ROOT_DIR, 'apps/admin/wrangler.production.generated.json'), { force: true }),
  ])
}
