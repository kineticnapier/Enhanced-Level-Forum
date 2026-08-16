import { readFile } from 'node:fs/promises'

const api = await readFile(new URL('../apps/api/src/public.ts', import.meta.url), 'utf8')
for (const route of [
  '/api/catalog/levels',
  '/api/catalog/levels/:id',
  '/api/catalog/references',
  '/api/governance/proposals',
  '/api/governance/proposals/:id',
  '/api/governance/proposals/:id/vote',
  '/api/governance/proposals/:id/comments',
]) {
  if (!api.includes(route)) throw new Error(`public API route missing: ${route}`)
}
for (const invariant of [
  'referenceStatus',
  'ratingVotes',
  'proposal_comments',
  'mine.vote AS my_vote',
  'inspectProposalRows',
  'Voting is closed for this proposal',
]) {
  if (!api.includes(invariant)) throw new Error(`public API invariant missing: ${invariant}`)
}

const inspect = await readFile(new URL('../apps/api/src/proposals/inspect.ts', import.meta.url), 'utf8')
for (const state of ['READY', 'STALE', 'INCOMPLETE', 'STATUS_ONLY', 'CLOSED']) {
  if (!inspect.includes(`'${state}'`)) throw new Error(`proposal execution state missing: ${state}`)
}
if (!inspect.includes('Canonical rating changed after proposal creation')) {
  throw new Error('proposal stale inspection missing canonical baseline check')
}
if (!inspect.includes('Reference changed after proposal creation')) {
  throw new Error('proposal stale inspection missing Reference baseline check')
}

const entry = await readFile(new URL('../apps/api/src/entry.ts', import.meta.url), 'utf8')
if (!entry.includes('registerPublicRoutes(app)')) throw new Error('public routes are not registered by the Worker entrypoint')

const web = await readFile(new URL('../apps/web/src/main.tsx', import.meta.url), 'utf8')
for (const ui of [
  '/catalog/levels',
  '/catalog/references',
  '/governance/proposals',
  'ProposalChange',
  'ExecutionState',
  'Coverage matrix',
  'Community difficulty evidence',
  'Discussion',
  'Voters',
]) {
  if (!web.includes(ui)) throw new Error(`public UI workflow missing: ${ui}`)
}
if (!web.includes('Array.from({length:30}')) throw new Error('Reference coverage UI must expose all 30 canonical tiers')

console.log('PUBLIC GOVERNANCE STATIC SMOKE PASSED')
console.log('catalog search/detail -> Reference filters -> proposal diff/stale state -> voting/comments')
