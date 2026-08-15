import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseEnvText, ROOT_DIR } from './local-env.mjs'

const apiBase = (process.env.ELF_API_URL?.trim() || 'http://localhost:8787/api').replace(/\/$/, '')

let devVars = {}
try {
  devVars = parseEnvText(await readFile(resolve(ROOT_DIR, 'apps/api/.dev.vars'), 'utf8'))
} catch (error) {
  if (error?.code !== 'ENOENT') throw error
}

const email = process.env.ELF_ADMIN_EMAIL?.trim() || devVars.BOOTSTRAP_ADMIN_EMAIL
const password = process.env.ELF_ADMIN_PASSWORD || devVars.BOOTSTRAP_ADMIN_PASSWORD
if (!email || !password) {
  console.error('Admin credentials are required.')
  console.error('Set ELF_ADMIN_EMAIL / ELF_ADMIN_PASSWORD, or configure apps/api/.dev.vars for local bootstrap.')
  process.exit(1)
}

async function jsonResponse(response) {
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(body?.error ?? `${response.status} ${response.statusText}`)
  }
  return body
}

const login = await fetch(`${apiBase}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
})
await jsonResponse(login)

const setCookies = typeof login.headers.getSetCookie === 'function'
  ? login.headers.getSetCookie()
  : [login.headers.get('set-cookie')].filter(Boolean)
const cookie = setCookies.map((value) => value.split(';', 1)[0]).join('; ')
if (!cookie) throw new Error('Login succeeded but no session cookie was returned')

let requestBody = {}
const fixturePath = process.argv[2]
if (fixturePath) {
  const absolute = resolve(process.cwd(), fixturePath)
  requestBody = { rawData: JSON.parse(await readFile(absolute, 'utf8')), sourceVersion: `fixture:${fixturePath}` }
  console.log(`Importing TUF fixture: ${absolute}`)
} else {
  console.log('Fetching the current TUF v2 levels and references through the ELF API...')
}

const imported = await fetch(`${apiBase}/admin/imports/tuf`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Cookie: cookie,
  },
  body: JSON.stringify(requestBody),
})
const result = await jsonResponse(imported)

console.log('\nTUF import complete')
console.log(`snapshot: ${result.snapshot.id}`)
console.log(`levels: ${result.summary.levels}`)
console.log(`rating observations: ${result.summary.ratingObservations}`)
console.log(`reference observations: ${result.summary.referenceObservations}`)
console.log(`linked to ELF levels: ${result.summary.linkedLevels}`)
console.log(`auto-linked by SHA-256: ${result.summary.autoLinkedBySha}`)
console.log(`issues: error=${result.summary.issues.ERROR} warning=${result.summary.issues.WARNING} info=${result.summary.issues.INFO}`)
console.log(`\nIssues endpoint: ${apiBase}/admin/imports/tuf/issues?snapshotId=${result.snapshot.id}`)
