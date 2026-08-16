import { readFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { ROOT_DIR } from './local-env.mjs'

const saved = { ...process.env }
Object.assign(process.env, {
  ELF_PUBLIC_ORIGIN: 'https://forum.example.com',
  ELF_ADMIN_ORIGIN: 'https://admin.example.com',
  ELF_API_ORIGIN: 'https://api.example.com',
  DATABASE_URL: 'postgres://user:password@db.example.net:5432/adoforum?sslmode=require',
  ELF_HYPERDRIVE_ID: '0123456789abcdef0123456789abcdef',
  AUTH_RATE_LIMIT_SALT: 'static-smoke-only-rate-limit-salt-0123456789',
})

try {
  const { loadProductionConfig, writeProductionWranglerConfigs } = await import('./production-config.mjs')
  const config = await loadProductionConfig({ requireHyperdrive: true, requireSecrets: true })
  await writeProductionWranglerConfigs(config)

  const apiPath = resolve(ROOT_DIR, 'apps/api/wrangler.production.generated.json')
  const webPath = resolve(ROOT_DIR, 'apps/web/wrangler.production.generated.json')
  const adminPath = resolve(ROOT_DIR, 'apps/admin/wrangler.production.generated.json')
  const [api, web, admin] = await Promise.all([
    readFile(apiPath, 'utf8').then(JSON.parse),
    readFile(webPath, 'utf8').then(JSON.parse),
    readFile(adminPath, 'utf8').then(JSON.parse),
  ])

  if (api.vars?.ENVIRONMENT !== 'production') throw new Error('API production ENVIRONMENT missing')
  if (api.vars?.WEB_ORIGIN !== 'https://forum.example.com' || api.vars?.ADMIN_ORIGIN !== 'https://admin.example.com') throw new Error('API production origins wrong')
  if (api.hyperdrive?.[0]?.binding !== 'HYPERDRIVE' || api.hyperdrive?.[0]?.id !== process.env.ELF_HYPERDRIVE_ID) throw new Error('Hyperdrive binding wrong')
  if (!api.secrets?.required?.includes('AUTH_RATE_LIMIT_SALT')) throw new Error('required Worker secret declaration missing')
  if (api.routes?.[0]?.pattern !== 'api.example.com' || api.routes?.[0]?.custom_domain !== true) throw new Error('API custom domain wrong')
  if (api.workers_dev !== false || web.workers_dev !== false || admin.workers_dev !== false) throw new Error('production workers.dev should be disabled')
  if (web.assets?.not_found_handling !== 'single-page-application' || admin.assets?.not_found_handling !== 'single-page-application') throw new Error('SPA static asset routing missing')
  if (web.routes?.[0]?.pattern !== 'forum.example.com' || admin.routes?.[0]?.pattern !== 'admin.example.com') throw new Error('frontend custom domains wrong')

  const setupSource = await readFile(resolve(ROOT_DIR, 'scripts/setup-production.mjs'), 'utf8')
  const deploySource = await readFile(resolve(ROOT_DIR, 'scripts/deploy-production.mjs'), 'utf8')
  const smokeSource = await readFile(resolve(ROOT_DIR, 'scripts/smoke-production.mjs'), 'utf8')
  for (const needle of ['hyperdrive', 'apply-migrations', 'create-admin']) if (!setupSource.includes(needle)) throw new Error(`production setup missing ${needle}`)
  for (const needle of ['--secrets-file', 'VITE_API_URL', 'wrangler.production.generated.json']) if (!deploySource.includes(needle)) throw new Error(`production deploy missing ${needle}`)
  for (const needle of ['__Host-elf_session', 'access-control-allow-origin', 'PRODUCTION DEPLOY SMOKE PASSED']) if (!smokeSource.includes(needle)) throw new Error(`production live smoke missing ${needle}`)

  console.log('CLOUDFLARE PRODUCTION DEPLOY STATIC SMOKE PASSED')
} finally {
  process.env = saved
  await Promise.all([
    rm(resolve(ROOT_DIR, 'apps/api/wrangler.production.generated.json'), { force: true }),
    rm(resolve(ROOT_DIR, 'apps/web/wrangler.production.generated.json'), { force: true }),
    rm(resolve(ROOT_DIR, 'apps/admin/wrangler.production.generated.json'), { force: true }),
  ])
}
