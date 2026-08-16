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
if (!shared.includes('levelVersionId: string') || !shared.includes('notes: string | null')) throw new Error('LevelDetail Reference baseline fields missing')

const api = await readFile(new URL('../apps/api/src/index.ts', import.meta.url), 'utf8')
for (const route of ['/api/levels', '/api/references', '/api/proposals', '/api/admin/levels', '/api/admin/references']) {
  if (!api.includes(route)) throw new Error(`route missing: ${route}`)
}
if (!api.includes("version: '0.3.0'")) throw new Error('API version mismatch')
if (!api.includes('decideProposal') || !api.includes('ProposalDecisionError')) {
  throw new Error('admin proposal decision route is not using transactional proposal execution')
}
if (!api.includes('prepareReferenceProposalPayload') || !api.includes('ReferenceProposalError')) {
  throw new Error('public Reference proposals must capture authoritative baselines at creation')
}

const services = await readFile(new URL('../apps/api/src/services.ts', import.meta.url), 'utf8')
if (!services.includes('publishCanonicalRatingInTransaction')) {
  throw new Error('canonical rerate core must be reusable inside proposal decision transaction')
}

const proposalExecution = await readFile(new URL('../apps/api/src/proposals/execution.ts', import.meta.url), 'utf8')
for (const invariant of [
  'FOR UPDATE',
  'currentCanonicalRating',
  'targetLevelVersionId',
  'proposedRating',
  'Proposal baseline is stale',
  'publishCanonicalRatingInTransaction',
  'REFERENCE_PROPOSAL_TYPES',
  'executeReferenceProposalInTransaction',
  'PROPOSAL_EXECUTION',
]) {
  if (!proposalExecution.includes(invariant)) throw new Error(`proposal execution invariant missing: ${invariant}`)
}
if (!proposalExecution.includes("execution: 'STATUS_ONLY'")) {
  throw new Error('non-executable proposal decisions must remain explicit status-only decisions')
}

const referenceProposals = await readFile(new URL('../apps/api/src/proposals/references.ts', import.meta.url), 'utf8')
for (const invariant of [
  'prepareReferenceProposalPayload',
  'currentCanonicalRating',
  'baselineReference',
  'Reference proposal baseline is stale',
  'PROPOSAL_ADD',
  'PROPOSAL_MOVE',
  'PROPOSAL_REMOVE',
  'ON CONFLICT DO NOTHING',
]) {
  if (!referenceProposals.includes(invariant)) throw new Error(`Reference proposal invariant missing: ${invariant}`)
}
for (const forbiddenMutation of ['INSERT INTO canonical_ratings','UPDATE canonical_ratings','DELETE FROM canonical_ratings']) {
  if (referenceProposals.includes(forbiddenMutation)) throw new Error(`Reference proposal execution must not mutate canonical rating: ${forbiddenMutation}`)
}

const entry = await readFile(new URL('../apps/api/src/entry.ts', import.meta.url), 'utf8')
for (const route of ["'/api/admin/imports/tuf'", "'/api/admin/imports/tuf/issues'", "'/api/admin/imports/tuf/unlinked'", "'/api/admin/imports/tuf/link'", "'/api/admin/imports/tuf/create-level'", "'/api/admin/imports/tuf/evidence'", "'/api/admin/imports/tuf/proposals'"]) {
  if (!entry.includes(route)) throw new Error(`TUF route missing: ${route}`)
}
if (!entry.includes("requireRole('MODERATOR')") || !entry.includes('createLevelFromTufObservation')) {
  throw new Error('TUF create-level route must require MODERATOR and use reconciliation service')
}
if (!entry.includes('fetchConsistentTufSnapshot')) throw new Error('TUF import route is not using consistent pagination fetch')

const tufFetcher = await readFile(new URL('../apps/api/src/importers/tuf-fetch.ts', import.meta.url), 'utf8')
for (const invariant of ['RECENT_ASC', 'REQUIRED_STABLE_PASSES = 2', 'MAX_ATTEMPTS = 4', 'duplicateIds', 'sameIds(current.ids, previous.ids)']) {
  if (!tufFetcher.includes(invariant)) throw new Error(`TUF pagination consistency invariant missing: ${invariant}`)
}
if (!tufFetcher.includes('pass.levels.length !== pass.total')) {
  throw new Error('TUF pagination must verify fetched count against source total')
}
if (!tufFetcher.includes('pass.pageTotals.every')) {
  throw new Error('TUF pagination must reject a total that changes mid-scan')
}

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

const tufReconciliation = await readFile(new URL('../apps/api/src/reconciliation/tuf.ts', import.meta.url), 'utf8')
for (const invariant of ['external_level_ids', 'external_level_observations', 'external_rating_observations', 'external_reference_observations', 'TUF_MANUAL_LINK', 'TUF_CREATE_LEVEL', 'linkTufObservationInTransaction', 'canonicalRatingCreated: false']) {
  if (!tufReconciliation.includes(invariant)) throw new Error(`TUF reconciliation invariant missing: ${invariant}`)
}
if (tufReconciliation.includes('canonical_ratings') || tufReconciliation.includes('difficulty_references')) {
  throw new Error('TUF reconciliation/create-level must not mutate canonical ELF rating/reference tables')
}
if (!tufReconciliation.includes('already mapped to a different ELF level')) {
  throw new Error('TUF manual linking must reject silent external-ID remaps')
}
if (!tufReconciliation.includes('conflicts with the selected ELF version SHA-256')) {
  throw new Error('TUF manual Version linking must reject known SHA conflicts')
}
if (!tufReconciliation.includes('Created') && !tufReconciliation.includes('INSERT INTO levels')) {
  throw new Error('TUF reconciliation must be able to create an ELF Level')
}

const tufEvidence = await readFile(new URL('../apps/api/src/evidence/tuf.ts', import.meta.url), 'utf8')
for (const invariant of ['canonical_ratings', 'external_rating_observations', 'external_reference_observations', 'proposals', 'createdFromExternalEvidence', 'PROPOSAL_CREATE']) {
  if (!tufEvidence.includes(invariant)) throw new Error(`TUF evidence proposal invariant missing: ${invariant}`)
}
for (const forbiddenMutation of [
  'INSERT INTO canonical_ratings',
  'UPDATE canonical_ratings',
  'DELETE FROM canonical_ratings',
  'INSERT INTO difficulty_references',
  'UPDATE difficulty_references',
  'DELETE FROM difficulty_references',
]) {
  if (tufEvidence.includes(forbiddenMutation)) throw new Error(`TUF evidence workflow must not mutate canonical data: ${forbiddenMutation}`)
}
if (!tufEvidence.includes('create proposals only from the latest TUF snapshot')) {
  throw new Error('TUF evidence proposals must reject stale snapshot evidence')
}
if (!tufEvidence.includes('not a canonical P/G/U integer tier')) {
  throw new Error('special/non-PGU TUF labels must not become canonical rerate proposals')
}
if (!tufEvidence.includes('An open proposal already covers this TUF evidence')) {
  throw new Error('TUF evidence workflow must guard duplicate open proposals')
}

const wrangler = await readFile(new URL('../apps/api/wrangler.jsonc', import.meta.url), 'utf8')
if (!wrangler.includes('"main": "src/entry.ts"')) throw new Error('Wrangler is not using importer-aware entrypoint')

const web = await readFile(new URL('../apps/web/src/main.tsx', import.meta.url), 'utf8')
const admin = await readFile(new URL('../apps/admin/src/main.tsx', import.meta.url), 'utf8')
const adminReconciliation = await readFile(new URL('../apps/admin/src/TufReconciliation.tsx', import.meta.url), 'utf8')
const adminEvidence = await readFile(new URL('../apps/admin/src/TufEvidenceProposals.tsx', import.meta.url), 'utf8')
if (web.includes('AdoForum') || admin.includes('AdoForum')) throw new Error('legacy AdoForum branding remains in UI')
if (!web.includes('Enhanced Level Forum') || !admin.includes('Enhanced Level Forum')) throw new Error('ELF branding missing')
if (!web.includes("type==='REFERENCE_ADD'") || !web.includes("type==='REFERENCE_MOVE'") || !web.includes("type==='REFERENCE_REMOVE'")) {
  throw new Error('public proposal UI must build executable Reference proposal payloads')
}
if (!admin.includes('TufReconciliation') || !adminReconciliation.includes('/admin/imports/tuf/unlinked') || !adminReconciliation.includes('/admin/imports/tuf/link')) {
  throw new Error('TUF reconciliation admin UI is not wired')
}
if (!adminReconciliation.includes('/admin/imports/tuf/create-level') || !adminReconciliation.includes('Create ELF Level & link') || !admin.includes('canCreateLevel')) {
  throw new Error('TUF create-level admin workflow is not wired with role gating')
}
if (!adminReconciliation.includes('TufEvidenceProposals') || !adminEvidence.includes('/admin/imports/tuf/evidence') || !adminEvidence.includes('/admin/imports/tuf/proposals')) {
  throw new Error('TUF evidence proposal admin UI is not wired')
}

for (const script of ['local-env.mjs', 'setup-local.mjs', 'dev-api.mjs', 'e2e-smoke.mjs', 'e2e-tuf-reconciliation.mjs', 'e2e-tuf-evidence.mjs', 'e2e-proposal-execution.mjs', 'e2e-reference-proposals.mjs', 'e2e-tuf-create-level.mjs', 'import-tuf.mjs']) {
  await readFile(new URL(`./${script}`, import.meta.url), 'utf8')
}

console.log('STATIC SMOKE PASSED')
console.log(`migrations: ${migrationFiles.join(', ')}`)
console.log('canonical difficulty: integer P/G/U tier')
console.log('human vote evidence: 5-step lean (-2..2), not a 100-step official scale')
console.log('TUF import: stable two-pass RECENT_ASC pagination; external observations only')
console.log('TUF reconciliation: existing links + create editable ELF Level/Version; canonical remains Unrated')
console.log('TUF evidence: latest linked rating comparison -> human RERATE proposal; canonical tables remain untouched')
console.log('proposal execution: approved RERATE is atomic; baseline/version guarded; stale References -> NEEDS_REVIEW')
console.log('Reference proposals: ADD/MOVE/REMOVE capture baselines, stale-guard, execute atomically, and preserve history')
