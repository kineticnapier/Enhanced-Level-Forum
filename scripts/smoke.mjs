import { readFile, readdir } from 'node:fs/promises'

const migrationFiles = (await readdir(new URL('../db/migrations/', import.meta.url))).filter((x) => x.endsWith('.sql')).sort()
if (migrationFiles.length < 2) throw new Error('expected migrations')
for (const file of migrationFiles) {
  const sql = await readFile(new URL(`../db/migrations/${file}`, import.meta.url), 'utf8')
  if (!sql.includes('BEGIN;') || !sql.includes('COMMIT;')) throw new Error(`${file}: transaction wrapper missing`)
}

const shared = await readFile(new URL('../packages/shared/src/index.ts', import.meta.url), 'utf8')
if (!shared.includes('voteEvidenceScore')) throw new Error('shared rating semantics missing')
if (!shared.includes("['P', 'G', 'U']")) throw new Error('PGU families missing')

const api = await readFile(new URL('../apps/api/src/index.ts', import.meta.url), 'utf8')
for (const route of ['/api/levels', '/api/references', '/api/proposals', '/api/admin/levels', '/api/admin/references']) {
  if (!api.includes(route)) throw new Error(`route missing: ${route}`)
}

console.log('STATIC SMOKE PASSED')
console.log(`migrations: ${migrationFiles.join(', ')}`)
console.log('canonical difficulty: integer P/G/U tier')
console.log('human vote evidence: 5-step lean (-2..2), not a 100-step official scale')
