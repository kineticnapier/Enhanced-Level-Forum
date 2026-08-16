import { spawn } from 'node:child_process'
import { ROOT_DIR, resolveDatabaseUrl } from './local-env.mjs'

const databaseUrl = await resolveDatabaseUrl()
const port = process.env.ELF_API_PORT?.trim() || '8787'
const hyperdriveEnv = 'CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE'
const isWindows = process.platform === 'win32'
const npmCommand = isWindows ? 'npm.cmd' : 'npm'

if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
  console.error(`Invalid ELF_API_PORT: ${port}`)
  process.exit(1)
}

const child = spawn(
  npmCommand,
  ['-w', '@elf/api', 'run', 'dev', '--', '--port', port, '--test-scheduled'],
  {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      [hyperdriveEnv]: process.env[hyperdriveEnv] || databaseUrl,
    },
    stdio: 'inherit',
    // npm on Windows is a .cmd shim. Node cannot execute .cmd files directly;
    // launch it through cmd.exe instead.
    shell: isWindows,
  },
)

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (!child.killed) child.kill(signal)
  })
}

child.on('error', (error) => {
  console.error(error)
  process.exitCode = 1
})
child.on('exit', (code, signal) => {
  if (code !== null) process.exitCode = code
  else if (signal) process.exitCode = 1
})
