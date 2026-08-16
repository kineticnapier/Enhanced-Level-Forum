import http from 'node:http'
import https from 'node:https'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseEnvText, ROOT_DIR } from './local-env.mjs'

const apiBase = (process.env.ELF_API_URL?.trim() || 'http://localhost:8787/api').replace(/\/$/, '')
const IMPORT_REQUEST_TIMEOUT_MS = 20 * 60 * 1000

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

function longJsonRequest(urlText, { method = 'GET', headers = {}, body } = {}) {
  const url = new URL(urlText)
  const transport = url.protocol === 'https:' ? https : url.protocol === 'http:' ? http : null
  if (!transport) throw new Error(`Unsupported ELF API protocol: ${url.protocol}`)

  const payload = body === undefined ? null : JSON.stringify(body)
  const requestHeaders = {
    Accept: 'application/json',
    ...headers,
  }
  if (payload !== null) {
    requestHeaders['Content-Type'] = 'application/json'
    requestHeaders['Content-Length'] = Buffer.byteLength(payload)
  }

  return new Promise((resolveRequest, rejectRequest) => {
    const request = transport.request(url, { method, headers: requestHeaders }, (response) => {
      let raw = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => { raw += chunk })
      response.on('error', rejectRequest)
      response.on('end', () => {
        let parsed = null
        if (raw) {
          try {
            parsed = JSON.parse(raw)
          } catch {
            rejectRequest(new Error(`ELF API returned non-JSON data (${response.statusCode ?? 'unknown status'})`))
            return
          }
        }

        const status = response.statusCode ?? 0
        if (status < 200 || status >= 300) {
          rejectRequest(new Error(parsed?.error ?? `${status} ${response.statusMessage ?? ''}`.trim()))
          return
        }
        resolveRequest(parsed)
      })
    })

    // Node's fetch/undici imposes a response-header timeout. A consistency-checked
    // TUF import intentionally performs multiple complete scans before the ELF API
    // sends its response, so use the core HTTP client with an explicit long timeout.
    request.setTimeout(IMPORT_REQUEST_TIMEOUT_MS, () => {
      request.destroy(new Error('ELF API import request timed out after 20 minutes'))
    })
    request.on('error', rejectRequest)
    if (payload !== null) request.write(payload)
    request.end()
  })
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
  console.log('Fetching the current TUF v2 data through the ELF API...')
  console.log('Level pagination is accepted only after two consecutive stable ID scans.')
}

const result = await longJsonRequest(`${apiBase}/admin/imports/tuf`, {
  method: 'POST',
  headers: { Cookie: cookie },
  body: requestBody,
})

console.log('\nTUF import complete')
console.log(`snapshot: ${result.snapshot.id}`)
console.log(`levels: ${result.summary.levels}`)
console.log(`rating observations: ${result.summary.ratingObservations}`)
console.log(`reference observations: ${result.summary.referenceObservations}`)
console.log(`linked to ELF levels: ${result.summary.linkedLevels}`)
console.log(`auto-linked by SHA-256: ${result.summary.autoLinkedBySha}`)
console.log(`issues: error=${result.summary.issues.ERROR} warning=${result.summary.issues.WARNING} info=${result.summary.issues.INFO}`)
console.log(`\nIssues endpoint: ${apiBase}/admin/imports/tuf/issues?snapshotId=${result.snapshot.id}`)
