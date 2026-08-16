import { pbkdf2Sync, randomBytes } from 'node:crypto'
import pg from 'pg'
import { resolveDatabaseUrl } from './local-env.mjs'

const { Client } = pg

function argument(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1]?.trim() : undefined
}

function base64Url(bytes) {
  return Buffer.from(bytes).toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '')
}

function hashPassword(password) {
  const iterations = 210_000
  const salt = randomBytes(16)
  const hash = pbkdf2Sync(password, salt, iterations, 32, 'sha256')
  return `pbkdf2-sha256$${iterations}$${base64Url(salt)}$${base64Url(hash)}`
}

function passwordError(password) {
  if (password.length < 12) return 'Password must be at least 12 characters.'
  if (password.length > 256) return 'Password must be at most 256 characters.'
  if (!password.trim()) return 'Password cannot be blank.'
  return null
}

const email = (argument('--email') ?? '').toLowerCase()
const displayName = argument('--name') ?? 'ELF Administrator'
const password = process.env.ELF_ADMIN_PASSWORD ?? ''

if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error('Usage: npm run auth:create-admin -- --email admin@example.com --name "Admin"')
  console.error('A valid --email is required.')
  process.exit(1)
}
if (!displayName || displayName.length > 80) {
  console.error('--name must contain 1..80 characters.')
  process.exit(1)
}
const policyError = passwordError(password)
if (policyError) {
  console.error(policyError)
  console.error('Set the password in ELF_ADMIN_PASSWORD. It is intentionally not accepted as a command-line argument.')
  process.exit(1)
}

const client = new Client({ connectionString: await resolveDatabaseUrl() })
await client.connect()
try {
  await client.query('BEGIN')
  const existing = await client.query(
    `SELECT id,email,display_name,role,is_active FROM users WHERE lower(email)=$1 FOR UPDATE`,
    [email],
  )

  if (existing.rowCount) {
    const row = existing.rows[0]
    if (row.role !== 'ADMIN' || row.is_active !== true) {
      throw new Error(`A user already exists for ${email} with role=${row.role}, active=${row.is_active}. Refusing to promote or reactivate it silently.`)
    }
    await client.query('ROLLBACK')
    console.log(`Active ADMIN already exists for ${email}; no changes made.`)
  } else {
    const passwordHash = hashPassword(password)
    const inserted = await client.query(
      `INSERT INTO users(email,display_name,role,password_hash,is_active,password_changed_at)
       VALUES ($1,$2,'ADMIN',$3,true,now())
       RETURNING id,email,display_name,role`,
      [email, displayName, passwordHash],
    )
    await client.query('COMMIT')
    const row = inserted.rows[0]
    console.log(`Created production ADMIN ${row.display_name} <${row.email}> (${row.id}).`)
  }
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined)
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
} finally {
  await client.end()
}
