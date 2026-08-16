import { readFile } from 'node:fs/promises'

const worker = await readFile(new URL('../apps/api/src/worker.ts', import.meta.url), 'utf8')
const scheduled = await readFile(new URL('../apps/api/src/importers/tuf-scheduled.ts', import.meta.url), 'utf8')
const importer = await readFile(new URL('../apps/api/src/importers/tuf.ts', import.meta.url), 'utf8')
const migration = await readFile(new URL('../db/migrations/005_tuf_incremental_crawl.sql', import.meta.url), 'utf8')
const statusMigration = await readFile(new URL('../db/migrations/008_tuf_cron_status.sql', import.meta.url), 'utf8')
const statusApi = await readFile(new URL('../apps/api/src/tuf-cron-status.ts', import.meta.url), 'utf8')
const entry = await readFile(new URL('../apps/api/src/entry.ts', import.meta.url), 'utf8')
const adminStatus = await readFile(new URL('../apps/admin/src/TufCronStatus.tsx', import.meta.url), 'utf8')
const reconciliation = await readFile(new URL('../apps/admin/src/TufReconciliation.tsx', import.meta.url), 'utf8')
const wrangler = await readFile(new URL('../apps/api/wrangler.jsonc', import.meta.url), 'utf8')
const productionConfig = await readFile(new URL('./production-config.mjs', import.meta.url), 'utf8')
const devApi = await readFile(new URL('./dev-api.mjs', import.meta.url), 'utf8')
const packageJson = await readFile(new URL('../package.json', import.meta.url), 'utf8')
const deploy = await readFile(new URL('./deploy-production.mjs', import.meta.url), 'utf8')

for (const invariant of [
  "import app from './entry'",
  'fetch: app.fetch',
  'async scheduled(',
  'runScheduledTufStep',
  'controller.cron',
  'controller.scheduledTime',
  'controller.noRetry?.()',
]) {
  if (!worker.includes(invariant)) throw new Error(`scheduled Worker invariant missing: ${invariant}`)
}

for (const invariant of [
  'PAGES_PER_RUN = 5',
  "LEVEL_SORT = 'RECENT_ASC'",
  'tuf_crawl_state',
  'tuf_crawl_levels',
  'verifyOverlap',
  'pg_try_advisory_lock',
  'importTufSnapshot',
  "'TUF_SCHEDULED_IMPORT'",
  "status: 'DEFERRED'",
  "status: 'PROGRESS'",
  'persistCronStatus',
  "status = result?.status ?? 'FAILED'",
  'consecutive_deferred',
]) {
  if (!scheduled.includes(invariant)) throw new Error(`incremental TUF crawl invariant missing: ${invariant}`)
}

for (const invariant of ['CREATE TABLE IF NOT EXISTS tuf_crawl_state', 'CREATE TABLE IF NOT EXISTS tuf_crawl_levels']) {
  if (!migration.includes(invariant)) throw new Error(`incremental TUF migration missing: ${invariant}`)
}
for (const invariant of ['last_run_at', 'last_status', 'last_reason', 'last_snapshot_id', 'consecutive_deferred', "'FAILED'"]) {
  if (!statusMigration.includes(invariant)) throw new Error(`TUF Cron status migration missing: ${invariant}`)
}

for (const invariant of [
  "app.get('/api/admin/imports/tuf/cron-status'",
  "const CRON_SCHEDULE = '*/30 * * * *'",
  'trackingAvailable',
  "return 'STALE'",
  'latestSnapshot',
  'stagedLevels',
]) {
  if (!statusApi.includes(invariant)) throw new Error(`TUF Cron status API missing: ${invariant}`)
}
if (!entry.includes('registerTufCronStatusRoutes(app)')) throw new Error('TUF Cron status routes are not registered')
for (const invariant of ['/admin/imports/tuf/cron-status', 'TUF Cron Status', 'Consecutive deferred', '60_000']) {
  if (!adminStatus.includes(invariant)) throw new Error(`TUF Cron admin panel missing: ${invariant}`)
}
if (!reconciliation.includes('<TufCronStatus/>')) throw new Error('TUF reconciliation must show Cron status')

for (const forbidden of ['canonical_ratings', 'difficulty_references']) {
  if (scheduled.includes(forbidden)) throw new Error(`scheduled crawler must stay outside canonical data: ${forbidden}`)
  if (importer.includes(forbidden)) throw new Error(`TUF importer must stay outside canonical data: ${forbidden}`)
}

const wranglerConfig = JSON.parse(wrangler)
if (wranglerConfig.main !== 'src/worker.ts') throw new Error('tracked Wrangler config must use worker.ts')
if (JSON.stringify(wranglerConfig.triggers?.crons) !== JSON.stringify(['*/30 * * * *'])) {
  throw new Error('tracked Wrangler config must schedule the TUF crawl every 30 minutes')
}

for (const invariant of [
  "const TUF_IMPORT_CRON = '*/30 * * * *'",
  "main: 'src/worker.ts'",
  'triggers: { crons: [TUF_IMPORT_CRON] }',
]) {
  if (!productionConfig.includes(invariant)) throw new Error(`production Cron config invariant missing: ${invariant}`)
}

if (!devApi.includes("'--test-scheduled'")) throw new Error('local API dev must expose the scheduled test handler')
if (!packageJson.includes('scripts/run-parallel.mjs build:shared build:api build:web build:admin')) throw new Error('root build is not parallelized')
if (!packageJson.includes('scripts/run-parallel.mjs smoke:core smoke:public smoke:auth smoke:deploy smoke:i18n smoke:cron')) throw new Error('static smoke checks are not parallelized')
if (!deploy.includes("runParallel('Build'")) throw new Error('production build is not parallelized')
if (!deploy.includes("=== Deploy (sequential) ===")) throw new Error('production deploy must be sequential')
if (deploy.includes("runParallel('Deploy'")) throw new Error('production deploy must not run Wrangler jobs in parallel')

console.log('TUF CRON STATIC SMOKE PASSED')
console.log('every 30 minutes -> 5 pages per step -> persistent staging -> complete external snapshot only')
console.log('Admin Imports shows persisted last tick/status/progress/snapshot health without touching canonical data')
console.log('npm build/smoke + production build run independent jobs in parallel; Wrangler deploy is sequential')
