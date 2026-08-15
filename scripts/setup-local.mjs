import { copyFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import pg from 'pg'
import { DEFAULT_DATABASE_URL, ROOT_DIR, resolveDatabaseUrl } from './local-env.mjs'

const { Client } = pg

async function exists(path) {
  try {
    await import('node:fs/promises').then(({ access }) => access(path))
    return true
  } catch {
    return false
  }
}

async function ensureCopy(example, target) {
  const sourcePath = resolve(ROOT_DIR, example)
  const targetPath = resolve(ROOT_DIR, target)
  if (await exists(targetPath)) {
    console.log(`keep   ${target}`)
    return
  }
  await copyFile(sourcePath, targetPath)
  console.log(`create ${target}`)
}

const major = Number(process.versions.node.split('.')[0])
if (!Number.isInteger(major) || major < 20) {
  console.error(`Node.js 20+ is required (current: ${process.version})`)
  process.exit(1)
}

const rootEnvPath = resolve(ROOT_DIR, '.env')
if (!await exists(rootEnvPath)) {
  if (process.env.DATABASE_URL?.trim()) {
    await writeFile(rootEnvPath, `DATABASE_URL=${process.env.DATABASE_URL.trim()}\n`, 'utf8')
    console.log('create .env from DATABASE_URL')
  } else {
    await copyFile(resolve(ROOT_DIR, '.env.example'), rootEnvPath)
    console.log('create .env from .env.example')
  }
} else {
  console.log('keep   .env')
}

await ensureCopy('apps/api/.dev.vars.example', 'apps/api/.dev.vars')
await ensureCopy('apps/web/.env.example', 'apps/web/.env.local')
await ensureCopy('apps/admin/.env.example', 'apps/admin/.env.local')

const databaseUrl = await resolveDatabaseUrl()
let parsed
try {
  parsed = new URL(databaseUrl)
} catch {
  console.error('DATABASE_URL is not a valid PostgreSQL URL.')
  process.exit(1)
}
if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
  console.error('DATABASE_URL must use postgres:// or postgresql://')
  process.exit(1)
}

const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ''))
if (!databaseName) {
  console.error('DATABASE_URL must include a database name.')
  process.exit(1)
}

const maintenanceUrl = new URL(databaseUrl)
maintenanceUrl.pathname = '/postgres'
const maintenance = new Client({ connectionString: maintenanceUrl.toString() })

try {
  await maintenance.connect()
} catch (error) {
  console.error('\nCould not connect to PostgreSQL using DATABASE_URL.')
  console.error(`Current URL: ${databaseUrl.replace(/:\/\/([^:]+):[^@]*@/, '://$1:***@')}`)
  console.error('Edit .env (or set DATABASE_URL in this shell) with the PostgreSQL password, then run npm run setup:local again.')
  console.error(error?.message ?? error)
  process.exit(1)
}

try {
  const found = await maintenance.query('SELECT 1 FROM pg_database WHERE datname = $1', [databaseName])
  if (!found.rowCount) {
    const quoted = `"${databaseName.replaceAll('"', '""')}"`
    console.log(`create database ${databaseName}`)
    await maintenance.query(`CREATE DATABASE ${quoted}`)
  } else {
    console.log(`keep   database ${databaseName}`)
  }
} finally {
  await maintenance.end()
}

const migration = spawnSync(process.execPath, [resolve(ROOT_DIR, 'scripts/apply-migrations.mjs')], {
  cwd: ROOT_DIR,
  env: { ...process.env, DATABASE_URL: databaseUrl },
  stdio: 'inherit',
})
if (migration.status !== 0) process.exit(migration.status ?? 1)

console.log('\nELF local setup complete.')
console.log('Run in separate terminals:')
console.log('  npm run dev:api')
console.log('  npm run dev:web')
console.log('  npm run dev:admin')
console.log('Then open http://localhost:5173 and http://localhost:5174')
if (databaseUrl === DEFAULT_DATABASE_URL) {
  console.log('Using the default local PostgreSQL credentials from .env.example.')
}
