import { spawn } from 'node:child_process'
import { ROOT_DIR, resolveDatabaseUrl } from './local-env.mjs'

const databaseUrl = await resolveDatabaseUrl()
const port = process.env.ELF_API_PORT?.trim() || '8787'
const hyperdriveEnv = 'CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE'
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'

const child = spawn(
  npmCommand,
  ['-w', '@elf/api', 'run', 'dev', '--', '--port', port],
  {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      [hyperdriveEnv]: process.env[hyperdriveEnv] || databaseUrl,
    },
    stdio: 'inherit',
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
