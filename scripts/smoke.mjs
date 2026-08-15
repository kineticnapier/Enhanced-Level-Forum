import { readFile, readdir } from 'node:fs/promises'

const migrationFiles = (await readdir(new URL('../db/migrations/', import.meta.url))).filter((x) => x.endsWith('.sql')).sort()
if (migrationFiles.length < 3) throw new Error('expected external import migration')
for (const file of migrationFiles) {
  const sql = await readFile(new URL(`../db/migrations/${file}`, import.meta.url), 'utf8')
  if (!sql.includes('BEGIN;') || !sql.includes('COMMIT;')) throw new Error(`${file}: transaction wrapper missing`)
}

const importMigration = await readFile(new URL('../db/migrations/003_external_import_observations.sql', import.meta.url), 'utf8')
for (const table of ['external_level_observations', 'external_reference_observations', 'import_issues']) {
  if (!importMigration.includes(table)) throw new Error(`TUF import schema missing: ${table}`)
}

const shared = await readFile(new URL('../packages/shared/src/index.ts', import.meta.url), 'utf8')
if (!shared.includes('voteEvidenceScore')) throw new Error('shared rating semantics missing')
if (!shared.includes("['P', 'G', 'U']")) throw new Error('PGU families missing')

const api = await readFile(new URL('../apps/api/src/index.ts', import.meta.url), 'utf8')
for (const route of ['/api/levels', '/api/references', '/api/proposals', '/api/admin/levels', '/api/admin/references']) {
  if (!api.includes(route)) throw new Error(`route missing: ${route}`)
}
if (!api.includes("version: '0.3.0'")) throw new Error('API version mismatch')

const entry = await readFile(new URL('../apps/api/src/entry.ts', import.meta.url), 'utf8')
if (!entry.includes("'/api/admin/imports/tuf'")) throw new Error('TUF import route missing')
if (!entry.includes("'/api/admin/imports/tuf/issues'")) throw new Error('TUF import issues route missing')

const tufImporter = await readFile(new URL('../apps/api/src/importers/tuf.ts', import.meta.url), 'utf8')
for (const invariant of ['external_rating_observations', 'external_reference_observations', 'external_level_ids', 'TUF_IMPORT']) {
  if (!tufImporter.includes(invariant)) throw new Error(`TUF importer invariant missing: ${invariant}`)
}
if (tufImporter.includes('canonical_ratings') || tufImporter.includes('difficulty_references')) {
  throw new Error('TUF importer must not write/read canonical ELF rating/reference tables')
}
if (!tufImporter.includes('external_id: issue.externalId')) {
  throw new Error('TUF import issues must preserve external source IDs')
}
if (!tufImporter.includes("severity: 'INFO', kind: 'MISSING_REFERENCE_TYPE'")) {
  throw new Error('missing TUF reference types should be informational source metadata')
}

const wrangler = await readFile(new URL('../apps/api/wrangler.jsonc', import.meta.url), 'utf8')
if (!wrangler.includes('"main": "src/entry.ts"')) throw new Error('Wrangler is not using importer-aware entrypoint')

const web = await readFile(new URL('../apps/web/src/main.tsx', import.meta.url), 'utf8')
const admin = await readFile(new URL('../apps/admin/src/main.tsx', import.meta.url), 'utf8')
if (web.includes('AdoForum') || admin.includes('AdoForum')) throw new Error('legacy AdoForum branding remains in UI')
if (!web.includes('Enhanced Level Forum') || !admin.includes('Enhanced Level Forum')) throw new Error('ELF branding missing')

for (const script of ['local-env.mjs', 'setup-local.mjs', 'dev-api.mjs', 'e2e-smoke.mjs', 'import-tuf.mjs']) {
  await readFile(new URL(`./${script}`, import.meta.url), 'utf8')
}

console.log('STATIC SMOKE PASSED')
console.log(`migrations: ${migrationFiles.join(', ')}`)
console.log('canonical difficulty: integer P/G/U tier')
console.log('human vote evidence: 5-step lean (-2..2), not a 100-step official scale')
console.log('TUF import: external observations only; canonical/reference tables isolated')
