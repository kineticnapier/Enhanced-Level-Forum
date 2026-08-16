import { spawn } from 'node:child_process'

const scripts = process.argv.slice(2).filter(Boolean)
if (!scripts.length) {
  console.error('Usage: node scripts/run-parallel.mjs <npm-script> [npm-script...]')
  process.exit(2)
}

function npmInvocation(script) {
  if (process.platform === 'win32') {
    const npmCli = process.env.npm_execpath
    if (!npmCli) throw new Error('npm_execpath is unavailable. Run this helper through npm run.')
    return { executable: process.execPath, args: [npmCli, 'run', script] }
  }
  return { executable: 'npm', args: ['run', script] }
}

function run(script) {
  return new Promise((resolve) => {
    const call = npmInvocation(script)
    console.log(`\n[parallel] starting ${script}`)
    const child = spawn(call.executable, call.args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'inherit',
      shell: false,
    })
    child.on('error', (error) => resolve({ script, code: 1, error }))
    child.on('exit', (code, signal) => resolve({ script, code: code ?? 1, signal }))
  })
}

const results = await Promise.all(scripts.map(run))
const failed = results.filter((result) => result.code !== 0)
if (failed.length) {
  for (const result of failed) {
    console.error(`[parallel] ${result.script} failed (${result.error?.message ?? result.signal ?? `exit ${result.code}`})`)
  }
  process.exitCode = failed[0].code || 1
} else {
  console.log(`\n[parallel] completed: ${scripts.join(', ')}`)
}
