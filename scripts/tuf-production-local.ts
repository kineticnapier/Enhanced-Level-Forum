import { loadProductionConfig, redactDatabaseUrl } from './production-config.mjs'
import { runScheduledTufStep } from '../apps/api/src/importers/tuf-scheduled.ts'

const MAX_STEPS = 500
const RETRY_BUSY_MS = 2_000
const BETWEEN_STEPS_MS = 100

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const config = await loadProductionConfig({ requireSecrets: false })
if (!config.databaseUrl) {
  console.error('DATABASE_URL is required. Configure it in .env.production or the environment first.')
  process.exit(1)
}

console.log('ELF local TUF production runner')
console.log(`DB: ${redactDatabaseUrl(config.databaseUrl)}`)
console.log('Heavy TUF crawl/finalization work will run on this PC while writing to the production PostgreSQL database.')
console.log('The same PostgreSQL advisory lock as the Cloudflare Cron is used, so concurrent runs do not overlap.\n')

const env = {
  HYPERDRIVE: {
    connectionString: config.databaseUrl,
  },
} as any

for (let step = 1; step <= MAX_STEPS; step++) {
  const startedAt = Date.now()
  const result = await runScheduledTufStep(env, {
    scheduledAt: new Date().toISOString(),
    executionSource: 'LOCAL_PRODUCTION_RUNNER',
    localStep: step,
  })
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(2)

  if (result.status === 'PROGRESS') {
    console.log(`[${step}] PROGRESS ${result.nextOffset}/${result.total} (${result.pagesFetched} pages, ${elapsed}s)`)
  } else if (result.status === 'FINALIZING') {
    console.log(`[${step}] FINALIZING ${result.phase} ${result.finalizeOffset}/${result.total} (${elapsed}s)`)
  } else if (result.status === 'IMPORTED') {
    console.log(`[${step}] IMPORTED snapshot=${result.snapshotId} levels=${result.levels} (${elapsed}s)`)
    console.log('\nTUF production snapshot import complete.')
    process.exit(0)
  } else if (result.status === 'BUSY') {
    console.log(`[${step}] BUSY: ${result.reason}; retrying in ${RETRY_BUSY_MS / 1000}s`)
    await sleep(RETRY_BUSY_MS)
    continue
  } else if (result.status === 'DEFERRED') {
    console.error(`[${step}] DEFERRED: ${result.reason}`)
    console.error('Stopping the local runner so the upstream/API problem can be inspected before retrying.')
    process.exit(2)
  } else if (result.status === 'RESET') {
    console.warn(`[${step}] RESET: ${result.reason}`)
  }

  await sleep(BETWEEN_STEPS_MS)
}

console.error(`Stopped after ${MAX_STEPS} steps without producing an IMPORTED snapshot.`)
process.exit(3)
