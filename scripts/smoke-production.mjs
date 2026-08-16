import { loadProductionConfig } from './production-config.mjs'

const config = await loadProductionConfig()

async function expectOk(url, init, label) {
  const response = await fetch(url, init)
  if (!response.ok) throw new Error(`${label} failed: ${response.status} ${response.statusText}`)
  return response
}

const health = await expectOk(`${config.apiOrigin}/api/health`, undefined, 'API health')
const healthJson = await health.json()
if (!healthJson.ok || !healthJson.database) throw new Error(`API health is not ready: ${JSON.stringify(healthJson)}`)

for (const [label, origin] of [['public', config.publicOrigin], ['admin', config.adminOrigin]]) {
  const response = await expectOk(origin, { redirect: 'follow' }, `${label} frontend`)
  const type = response.headers.get('content-type') ?? ''
  if (!type.includes('text/html')) throw new Error(`${label} frontend did not return HTML (${type})`)
}

await expectOk(`${config.apiOrigin}/api/catalog/levels?limit=1`, undefined, 'public catalog')

const blocked = await fetch(`${config.apiOrigin}/api/auth/logout`, {
  method: 'POST',
  headers: { Origin: 'https://not-elf.invalid' },
})
if (blocked.status !== 403) throw new Error(`disallowed Origin guard expected 403, got ${blocked.status}`)

for (const origin of [config.publicOrigin, config.adminOrigin]) {
  const preflight = await fetch(`${config.apiOrigin}/api/auth/logout`, {
    method: 'OPTIONS',
    headers: {
      Origin: origin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type',
    },
  })
  if (preflight.status !== 204) throw new Error(`CORS preflight for ${origin} expected 204, got ${preflight.status}`)
  if (preflight.headers.get('access-control-allow-origin') !== origin) throw new Error(`CORS did not reflect allowed origin ${origin}`)
}

if (config.adminEmail && config.adminPassword) {
  const login = await fetch(`${config.apiOrigin}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: config.adminOrigin },
    body: JSON.stringify({ email: config.adminEmail, password: config.adminPassword }),
  })
  if (!login.ok) throw new Error(`production ADMIN login failed: ${login.status} ${await login.text()}`)
  const setCookie = login.headers.get('set-cookie') ?? ''
  if (!/^__Host-elf_session=/.test(setCookie)) throw new Error('production session cookie is not __Host-elf_session')
  for (const required of ['Secure', 'HttpOnly', 'SameSite=Lax', 'Path=/']) {
    if (!setCookie.toLowerCase().includes(required.toLowerCase())) throw new Error(`production session cookie is missing ${required}`)
  }
  if (/;\s*Domain=/i.test(setCookie)) throw new Error('production session cookie must not contain Domain')
  const cookie = setCookie.split(';', 1)[0]
  const me = await expectOk(`${config.apiOrigin}/api/auth/me`, { headers: { Cookie: cookie } }, 'authenticated /auth/me')
  const meJson = await me.json()
  if (meJson.user?.role !== 'ADMIN') throw new Error(`expected production ADMIN session, got ${JSON.stringify(meJson)}`)
  await fetch(`${config.apiOrigin}/api/auth/logout`, { method: 'POST', headers: { Cookie: cookie, Origin: config.adminOrigin } })
} else {
  console.log('ADMIN login smoke skipped: ELF_ADMIN_EMAIL / ELF_ADMIN_PASSWORD not configured.')
}

console.log('PRODUCTION DEPLOY SMOKE PASSED')
console.log(`${config.publicOrigin} -> ${config.apiOrigin} -> PostgreSQL/Hyperdrive; CORS/origin guard verified`)
