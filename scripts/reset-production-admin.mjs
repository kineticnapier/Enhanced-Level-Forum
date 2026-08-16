import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { loadProductionConfig } from './production-config.mjs'
import { ROOT_DIR } from './local-env.mjs'

const config = await loadProductionConfig({ requireAdmin: true })
const script = resolve(ROOT_DIR, 'scripts/create-admin.mjs')
const result = spawnSync(process.execPath, [script, '--email', config.adminEmail, '--name', config.adminName, '--reset-password'], {
  cwd: ROOT_DIR,
  env: {
    ...process.env,
    DATABASE_URL: config.databaseUrl,
    ELF_ADMIN_PASSWORD: config.adminPassword,
  },
  stdio: 'inherit',
  shell: false,
})

if (result.error) {
  console.error(result.error.message)
  process.exit(1)
}
process.exit(result.status ?? 1)
