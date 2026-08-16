import { rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { spawn } from 'node:child_process'
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

function run(command, args, { cwd = ROOT_DIR, env = process.env, label = `${command} ${args.join(' ')}` } = {}) {
  console.log(`\n> ${label}`)
  return new Promise((resolvePromise, reject) => {
    let call
    try {
      call = invocation(command, args)
    } catch (error) {
      reject(error)
      return
    }

    const child = spawn(call.executable, call.args, { cwd, env, stdio: 'inherit', shell: false })
    child.on('error', reject)
    child.on('exit', (code, signal) => {
      if (code === 0) resolvePromise()
      else reject(new Error(`${label} failed (${signal ?? `exit ${code ?? 1}`})`))
    })
  })
}

async function runParallel(label, tasks) {
  console.log(`\n=== ${label} (${tasks.length} parallel jobs) ===`)
  const results = await Promise.allSettled(tasks.map((task) => run(task.command, task.args, task.options)))
  const failures = results
    .map((result, index) => ({ result, task: tasks[index] }))
    .filter(({ result }) => result.status === 'rejected')
  if (failures.length) {
    for (const { result, task } of failures) {
      console.error(`[parallel] ${task.options?.label ?? task.command} failed:`, result.reason?.message ?? result.reason)
    }
    throw new Error(`${label} failed in ${failures.length} job(s)`)
  }
}

const config = await loadProductionConfig({ requireHyperdrive: true, requireSecrets: true })
await writeProductionWranglerConfigs(config)
const secretsPath = await writeApiSecretsFile(config)

console.log('Deploying ELF production')
console.log(`Public: ${config.publicOrigin}`)
console.log(`Admin:  ${config.adminOrigin}`)
console.log(`API:    ${config.apiOrigin}`)

const apiDir = resolve(ROOT_DIR, 'apps/api')
const webDir = resolve(ROOT_DIR, 'apps/web')
const adminDir = resolve(ROOT_DIR, 'apps/admin')
const frontendEnv = { ...process.env, VITE_API_URL: `${config.apiOrigin}/api` }

try {
  await runParallel('Build', [
    { command: 'npm', args: ['run', 'build:shared'], options: { label: 'shared build' } },
    { command: 'npm', args: ['run', 'build:api'], options: { label: 'API build' } },
    { command: 'npm', args: ['run', 'build'], options: { cwd: webDir, env: frontendEnv, label: 'public frontend build' } },
    { command: 'npm', args: ['run', 'build'], options: { cwd: adminDir, env: frontendEnv, label: 'admin frontend build' } },
  ])

  await runParallel('Deploy', [
    {
      command: 'npx',
      args: ['wrangler', 'deploy', '--config', 'wrangler.production.generated.json', '--secrets-file', secretsPath],
      options: { cwd: apiDir, label: 'API deploy' },
    },
    {
      command: 'npx',
      args: ['wrangler', 'deploy', '--config', 'wrangler.production.generated.json'],
      options: { cwd: webDir, label: 'public frontend deploy' },
    },
    {
      command: 'npx',
      args: ['wrangler', 'deploy', '--config', 'wrangler.production.generated.json'],
      options: { cwd: adminDir, label: 'admin frontend deploy' },
    },
  ])
} finally {
  await rm(secretsPath, { force: true }).catch(() => undefined)
}

console.log('\nProduction deploy complete.')
console.log('Run npm run production:smoke to verify the live deployment.')
