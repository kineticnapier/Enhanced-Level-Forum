import { readFile } from 'node:fs/promises'

const worker = await readFile(new URL('../apps/api/src/worker.ts', import.meta.url), 'utf8')
const runner = await readFile(new URL('../apps/api/src/importers/tuf-run.ts', import.meta.url), 'utf8')
const importer = await readFile(new URL('../apps/api/src/importers/tuf.ts', import.meta.url), 'utf8')
const wrangler = await readFile(new URL('../apps/api/wrangler.jsonc', import.meta.url), 'utf8')
const productionConfig = await readFile(new URL('./production-config.mjs', import.meta.url), 'utf8')
const devApi = await readFile(new URL('./dev-api.mjs', import.meta.url), 'utf8')

for (const invariant of [
  "import app from './entry'",
  'fetch: app.fetch',
  'async scheduled(',
  "executionSource: 'SCHEDULED'",
  'actorId: null',
  'controller.cron',
  'controller.scheduledTime',
  'runTufImport',
]) {
  if (!worker.includes(invariant)) throw new Error(`scheduled Worker invariant missing: ${invariant}`)
}

for (const invariant of [
  'fetchConsistentTufSnapshot',
  'importTufSnapshot',
  "'TUF_SCHEDULED_IMPORT'",
  "executionSource === 'SCHEDULED'",
  'auditMetadata',
]) {
  if (!runner.includes(invariant)) throw new Error(`scheduled TUF runner invariant missing: ${invariant}`)
}

for (const forbidden of ['canonical_ratings', 'difficulty_references']) {
  if (runner.includes(forbidden)) throw new Error(`scheduled runner must stay outside canonical data: ${forbidden}`)
  if (importer.includes(forbidden)) throw new Error(`TUF importer must stay outside canonical data: ${forbidden}`)
}

const wranglerConfig = JSON.parse(wrangler)
if (wranglerConfig.main !== 'src/worker.ts') throw new Error('tracked Wrangler config must use worker.ts')
if (JSON.stringify(wranglerConfig.triggers?.crons) !== JSON.stringify(['17 * * * *'])) {
  throw new Error('tracked Wrangler config must schedule the hourly TUF import at minute 17')
}

for (const invariant of [
  "const TUF_IMPORT_CRON = '17 * * * *'",
  "main: 'src/worker.ts'",
  'triggers: { crons: [TUF_IMPORT_CRON] }',
]) {
  if (!productionConfig.includes(invariant)) throw new Error(`production Cron config invariant missing: ${invariant}`)
}

if (!devApi.includes("'--test-scheduled'")) throw new Error('local API dev must expose the scheduled test handler')

console.log('TUF CRON STATIC SMOKE PASSED')
console.log('hourly minute-17 UTC -> scheduled Worker -> stable TUF fetch -> external observations only')
