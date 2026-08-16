import { readFile } from 'node:fs/promises'

const migration = await readFile(new URL('../db/migrations/007_rating_queue.sql', import.meta.url), 'utf8')
for (const invariant of [
  'CREATE TABLE IF NOT EXISTS rating_queue_items',
  'CREATE TABLE IF NOT EXISTS rating_queue_claims',
  "'OPEN','REVIEW_READY','CLOSED'",
  "'ACTIVE','SUBMITTED','RELEASED'",
  'rating_votes_one_per_user_version_idx',
]) {
  if (!migration.includes(invariant)) throw new Error(`rating queue migration missing: ${invariant}`)
}

const queue = await readFile(new URL('../apps/api/src/rating-queue.ts', import.meta.url), 'utf8')
for (const invariant of [
  'MAX_ACTIVE_QUEUE_ITEMS = 30',
  'MAX_ACTIVE_CLAIMS_PER_RATER = 5',
  'CONSENSUS_SPREAD = 0.8',
  "reason: 'CONSENSUS'",
  "reason: 'DISAGREEMENT'",
  "reason: 'DISAGREEMENT_NEEDS_ONE_MORE'",
  "app.get('/api/rating-queue'",
  "app.post('/api/rating-queue/:id/claim'",
  "app.delete('/api/rating-queue/:id/claim'",
  "app.post('/api/admin/rating-queue'",
  "app.get('/api/admin/rating-queue'",
  "app.post('/api/levels/:id/votes'",
  "ON CONFLICT(level_version_id,user_id)",
  "status='SUBMITTED'",
  'Claim this rating queue item before submitting a rating',
]) {
  if (!queue.includes(invariant)) throw new Error(`rating queue API missing: ${invariant}`)
}
for (const forbidden of ['external_rating_observations', 'TUF_SCHEDULED_IMPORT', 'tuf_crawl_levels']) {
  if (queue.includes(forbidden)) throw new Error(`rater queue must not expose/use TUF evidence: ${forbidden}`)
}

const entry = await readFile(new URL('../apps/api/src/entry.ts', import.meta.url), 'utf8')
if (!entry.includes('registerRatingQueueRoutes(app)')) throw new Error('rating queue routes are not registered')
if (entry.indexOf('registerRatingQueueRoutes(app)') > entry.indexOf("app.route('/', coreApp)")) {
  throw new Error('queue-aware vote route must be registered before legacy core voting')
}

const services = await readFile(new URL('../apps/api/src/services.ts', import.meta.url), 'utf8')
for (const invariant of ['rating_queue_items', "status='CLOSED'", 'closedRatingQueueItemId']) {
  if (!services.includes(invariant)) throw new Error(`canonical publish does not close queue: ${invariant}`)
}

const shared = await readFile(new URL('../packages/shared/src/index.ts', import.meta.url), 'utf8')
for (const invariant of ['RatingQueueItem', 'RatingQueueStatus', 'RatingQueueClaimStatus', 'RatingQueueReviewReason']) {
  if (!shared.includes(invariant)) throw new Error(`shared queue type missing: ${invariant}`)
}

const admin = await readFile(new URL('../apps/admin/src/LevelManagement.tsx', import.meta.url), 'utf8')
for (const invariant of ['/admin/rating-queue', '査定募集を開始', 'Review Ready']) {
  if (!admin.includes(invariant)) throw new Error(`admin rating queue UI missing: ${invariant}`)
}

const web = await readFile(new URL('../apps/web/src/main.tsx', import.meta.url), 'utf8')
const queueUi = await readFile(new URL('../apps/web/src/RatingQueue.tsx', import.meta.url), 'utf8')
for (const invariant of ["page: 'rating-queue'", '#/rating-queue', 'RatingQueuePage']) {
  if (!web.includes(invariant)) throw new Error(`public queue route missing: ${invariant}`)
}
for (const invariant of ['/rating-queue', 'これを査定する', '自分の担当', 'Review Ready', '外部Rating']) {
  if (!queueUi.includes(invariant)) throw new Error(`rater queue UI missing: ${invariant}`)
}

console.log('RATING QUEUE STATIC SMOKE PASSED')
console.log('explicit max-30 queue -> max-5 claims/rater -> 2-vote consensus or 3-vote disagreement -> Review Ready -> staff canonical closes round')
