import { readFile } from 'node:fs/promises'

const migration = await readFile(new URL('../db/migrations/011_level_submissions.sql', import.meta.url), 'utf8')
for (const invariant of ['CREATE TABLE IF NOT EXISTS level_submissions', 'submitted_by uuid', 'created_level_version_id', "status IN ('PENDING','APPROVED','REJECTED','WITHDRAWN')"]) {
  if (!migration.includes(invariant)) throw new Error(`submission migration missing: ${invariant}`)
}
const variantMigration = await readFile(new URL('../db/migrations/012_level_variants.sql', import.meta.url), 'utf8')
for (const invariant of ['variant_name text', 'variant_kind text', 'variant_key_limit integer']) {
  if (!variantMigration.includes(invariant)) throw new Error(`Variant-aware submission migration missing: ${invariant}`)
}

const routes = await readFile(new URL('../apps/api/src/submissions.ts', import.meta.url), 'utf8')
for (const invariant of [
  "app.post('/api/submissions'",
  "app.get('/api/submissions/mine'",
  "app.post('/api/submissions/:id/withdraw'",
  "app.get('/api/admin/submissions'",
  "app.post('/api/admin/submissions/:id/approve'",
  "app.post('/api/admin/submissions/:id/reject'",
  "requireRole('VIEWER')",
  "requireRole('MODERATOR')",
  'PENDING_PER_USER_LIMIT = 5',
  'VARIANT_KINDS',
  'variantName',
  'variantKeyLimit',
  'INSERT INTO level_variants',
  'variant_id,label,sha256',
  'A LevelVersion with this SHA-256 already exists.',
  "ratingQueue: 'not automatically enqueued'",
]) {
  if (!routes.includes(invariant)) throw new Error(`submission route missing: ${invariant}`)
}

const entry = await readFile(new URL('../apps/api/src/entry.ts', import.meta.url), 'utf8')
if (!entry.includes('registerSubmissionRoutes(app)')) throw new Error('submission routes are not registered')
if (entry.indexOf('registerSubmissionRoutes(app)') > entry.indexOf("app.route('/', coreApp)")) {
  throw new Error('submission routes must be registered before legacy core routes')
}

const publicIndex = await readFile(new URL('../apps/web/index.html', import.meta.url), 'utf8')
const publicEntry = await readFile(new URL('../apps/web/src/submission-entry.tsx', import.meta.url), 'utf8')
const publicPage = await readFile(new URL('../apps/web/src/SubmitLevel.tsx', import.meta.url), 'utf8')
for (const invariant of ['submission-entry.tsx']) if (!publicIndex.includes(invariant)) throw new Error(`public submission entry missing from index: ${invariant}`)
for (const invariant of ["location.hash==='#/submit'", 'SubmitLevelPage', 'a.href=\'#/submit\'']) if (!publicEntry.includes(invariant)) throw new Error(`public submission route missing: ${invariant}`)
for (const invariant of ['SHA-256', '/submissions/mine', "method:'POST'", 'Rating Queue', 'variantKind', 'KEYLIMIT', 'NO_KEY_LIMIT']) if (!publicPage.includes(invariant)) throw new Error(`public submission UI missing: ${invariant}`)

const adminIndex = await readFile(new URL('../apps/admin/index.html', import.meta.url), 'utf8')
const adminEntry = await readFile(new URL('../apps/admin/src/submission-admin-entry.tsx', import.meta.url), 'utf8')
const adminReview = await readFile(new URL('../apps/admin/src/SubmissionReview.tsx', import.meta.url), 'utf8')
if (!adminIndex.includes('submission-admin-entry.tsx')) throw new Error('admin submission entry is not loaded')
for (const invariant of ["location.hash==='#/submissions'", 'SubmissionReview', 'data-submission-review']) if (!adminEntry.includes(invariant)) throw new Error(`admin submission route missing: ${invariant}`)
for (const invariant of ['/admin/submissions?status=', '/approve', '/reject', 'Rating Queueには自動投入されません', 'variantName', 'variantKeyLimit']) if (!adminReview.includes(invariant)) throw new Error(`admin submission review missing: ${invariant}`)

console.log('LEVEL SUBMISSION STATIC SMOKE PASSED')
console.log('VIEWER submit -> staff review -> Level/Variant/Version; no automatic Rating Queue enqueue')
