import { spawn, spawnSync } from 'node:child_process'

const scripts = process.argv.slice(2).filter(Boolean)
if (!scripts.length) {
  console.error('Usage: node scripts/run-parallel.mjs <npm-script> [npm-script...]')
  process.exit(2)
}

const activeChildren = new Map()
let shuttingDown = false

function npmInvocation(script) {
  if (process.platform === 'win32') {
    const npmCli = process.env.npm_execpath
    if (!npmCli) throw new Error('npm_execpath is unavailable. Run this helper through npm run.')
    return { executable: process.execPath, args: [npmCli, 'run', script] }
  }
  return { executable: 'npm', args: ['run', script] }
}

function terminateTree(child, signal = 'SIGTERM') {
  if (!child?.pid || child.exitCode !== null) return
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
    return
  }
  try { child.kill(signal) } catch { /* already gone */ }
}

function stopAll(signal) {
  if (shuttingDown) return
  shuttingDown = true
  console.error(`\n[parallel] interrupted by ${signal}; terminating ${activeChildren.size} child process tree(s)...`)
  for (const child of activeChildren.values()) terminateTree(child, signal === 'SIGINT' ? 'SIGINT' : 'SIGTERM')
  process.exit(signal === 'SIGINT' ? 130 : 143)
}

process.once('SIGINT', () => stopAll('SIGINT'))
process.once('SIGTERM', () => stopAll('SIGTERM'))

function run(script) {
  return new Promise((resolve) => {
    let call
    try {
      call = npmInvocation(script)
    } catch (error) {
      resolve({ script, code: 1, error })
      return
    }
    console.log(`\n[parallel] starting ${script}`)
    const child = spawn(call.executable, call.args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'inherit',
      shell: false,
    })
    activeChildren.set(script, child)
    child.on('error', (error) => {
      activeChildren.delete(script)
      resolve({ script, code: 1, error })
    })
    child.on('exit', (code, signal) => {
      activeChildren.delete(script)
      resolve({ script, code: code ?? 1, signal })
    })
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
