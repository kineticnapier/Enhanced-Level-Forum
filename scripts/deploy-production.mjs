import { rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { loadProductionConfig, writeApiSecretsFile, writeProductionWranglerConfigs } from './production-config.mjs'
import { ROOT_DIR } from './local-env.mjs'

function invocation(command, args) {
  if (process.platform === 'win32' && ['npm', 'npx'].includes(command)) {
    const npmCli = process.env.npm_execpath
    if (!npmCli) {
      throw new Error(`Cannot launch ${command} safely on Windows because npm_execpath is unavailable. Run this script through npm run.`)
    }
    if (command === 'npm') return { executable: process.execPath, args: [npmCli, ...args] }
    return { executable: process.execPath, args: [npmCli, 'exec', '--', ...args] }
  }
  return { executable: command, args }
}

function run(command, args, { cwd = ROOT_DIR, env = process.env } = {}) {
  console.log(`\n> ${command} ${args.join(' ')}`)

  let call
  try {
    call = invocation(command, args)
  } catch (error) {
    console.error(error?.message ?? error)
    process.exit(1)
  }

  const result = spawnSync(call.executable, call.args, { cwd, env, stdio: 'inherit', shell: false })
  if (result.error) {
    console.error(result.error.message)
    process.exit(1)
  }
  if (result.status !== 0) process.exit(result.status ?? 1)
}

const config = await loadProductionConfig({ requireHyperdrive: true, requireSecrets: true })
await writeProductionWranglerConfigs(config)
const secretsPath = await writeApiSecretsFile(config)

console.log('Deploying ELF production')
console.log(`Public: ${config.publicOrigin}`)
console.log(`Admin:  ${config.adminOrigin}`)
console.log(`API:    ${config.apiOrigin}`)

try {
  run('npm', ['run', 'build:shared'])
  run('npm', ['run', 'build:api'])

  const apiDir = resolve(ROOT_DIR, 'apps/api')
  run('npx', ['wrangler', 'deploy', '--config', 'wrangler.production.generated.json', '--secrets-file', secretsPath], { cwd: apiDir })

  const frontendEnv = { ...process.env, VITE_API_URL: `${config.apiOrigin}/api` }
  const webDir = resolve(ROOT_DIR, 'apps/web')
  run('npm', ['run', 'build'], { cwd: webDir, env: frontendEnv })
  run('npx', ['wrangler', 'deploy', '--config', 'wrangler.production.generated.json'], { cwd: webDir })

  const adminDir = resolve(ROOT_DIR, 'apps/admin')
  run('npm', ['run', 'build'], { cwd: adminDir, env: frontendEnv })
  run('npx', ['wrangler', 'deploy', '--config', 'wrangler.production.generated.json'], { cwd: adminDir })
} finally {
  await rm(secretsPath, { force: true }).catch(() => undefined)
}

console.log('\nProduction deploy complete.')
console.log('Run npm run production:smoke to verify the live deployment.')
