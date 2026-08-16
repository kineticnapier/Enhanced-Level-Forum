import { readFile } from 'node:fs/promises'

const migration = await readFile(new URL('../db/migrations/006_level_metadata.sql', import.meta.url), 'utf8')
for (const invariant of ['artist text', 'effecter text', 'video_url text', "artist = 'Unknown'"]) {
  if (!migration.includes(invariant)) throw new Error(`level metadata migration missing: ${invariant}`)
}

const routes = await readFile(new URL('../apps/api/src/level-metadata.ts', import.meta.url), 'utf8')
for (const invariant of [
  'registerLevelMetadataRoutes',
  'registerLevelMetadataCatalogRoutes',
  'artist',
  'effecter',
  'video_url',
  'videoUrl',
  "requireRole('MODERATOR')",
  'createLevelFromTufObservation',
]) {
  if (!routes.includes(invariant)) throw new Error(`practical level metadata route missing: ${invariant}`)
}

const entry = await readFile(new URL('../apps/api/src/entry.ts', import.meta.url), 'utf8')
if (entry.indexOf('registerLevelMetadataRoutes(app)') > entry.indexOf("app.route('/', coreApp)")) {
  throw new Error('practical Level CRUD must be registered before legacy core routes')
}
if (entry.indexOf('registerLevelMetadataCatalogRoutes(app)') > entry.indexOf('registerPublicRoutes(app)')) {
  throw new Error('practical catalog must be registered before legacy catalog routes')
}

const shared = await readFile(new URL('../packages/shared/src/index.ts', import.meta.url), 'utf8')
for (const invariant of ['artist: string', 'effecter: string | null', 'videoUrl: string | null']) {
  if (!shared.includes(invariant)) throw new Error(`shared metadata field missing: ${invariant}`)
}

const admin = await readFile(new URL('../apps/admin/src/LevelManagement.tsx', import.meta.url), 'utf8')
for (const invariant of ['アーティスト名', '制作者 / チーム名', 'エフェクター', '動画URL', 'SHA-256', "videoUrl:video||null"]) {
  if (!admin.includes(invariant)) throw new Error(`admin metadata UI missing: ${invariant}`)
}
if (admin.includes('譜面名')) throw new Error('new Level registration UI must not ask for a separate chart title')

const reconciliation = await readFile(new URL('../apps/admin/src/TufReconciliation.tsx', import.meta.url), 'utf8')
for (const invariant of ['createArtist', 'createEffecter', 'createVideo', 'videoUrl:createVideo||null']) {
  if (!reconciliation.includes(invariant)) throw new Error(`TUF create-level metadata UI missing: ${invariant}`)
}

console.log('PRACTICAL LEVEL METADATA STATIC SMOKE PASSED')
console.log('song + artist + creator/team + optional effecter; version + download/video/SHA')
