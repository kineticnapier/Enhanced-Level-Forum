import { readFile } from 'node:fs/promises'

const migration = await readFile(new URL('../db/migrations/012_level_variants.sql', import.meta.url), 'utf8')
for (const invariant of [
  'CREATE TABLE IF NOT EXISTS level_variants',
  "'ORIGINAL','NERFED','BUFFED','KEYLIMIT','NO_KEY_LIMIT','CUSTOM'",
  'ADD COLUMN IF NOT EXISTS variant_id uuid NULL',
  'ALTER COLUMN variant_id SET NOT NULL',
  'level_versions_variant_fk',
  'level_variants_current_version_fk',
  'level_variants_primary_idx',
  'elf_assign_primary_variant',
  'level_version variant_id must belong to level_id',
]) {
  if (!migration.includes(invariant)) throw new Error(`Level Variant migration missing invariant: ${invariant}`)
}

const routes = await readFile(new URL('../apps/api/src/level-variants.ts', import.meta.url), 'utf8')
for (const invariant of [
  'registerLevelVariantRoutes',
  "app.get('/api/levels/:id/variants'",
  "app.post('/api/admin/levels/:id/variants'",
  "app.patch('/api/admin/levels/:id/variants/:variantId'",
  "app.post('/api/admin/levels/:id/variants/:variantId/versions'",
  "requireRole('MODERATOR')",
  'variant_id',
  'is_primary',
  'current_version_id',
]) {
  if (!routes.includes(invariant)) throw new Error(`Level Variant route missing invariant: ${invariant}`)
}

const entry = await readFile(new URL('../apps/api/src/entry.ts', import.meta.url), 'utf8')
if (!entry.includes("import { registerLevelVariantRoutes } from './level-variants'")) throw new Error('Variant routes are not imported')
if (!entry.includes('registerLevelVariantRoutes(app)')) throw new Error('Variant routes are not registered')
if (entry.indexOf('registerLevelVariantRoutes(app)') > entry.indexOf("app.route('/', coreApp)")) throw new Error('Variant routes must be registered before legacy core routes')

const admin = await readFile(new URL('../apps/admin/src/LevelManagement.tsx', import.meta.url), 'utf8')
for (const invariant of ['VariantKind', 'NERFED', 'KEYLIMIT', 'NO_KEY_LIMIT', 'Variantを追加', '/variants/${variant.id}/versions', 'isPrimary:true']) {
  if (!admin.includes(invariant)) throw new Error(`Variant admin UI missing: ${invariant}`)
}

const docs = await readFile(new URL('../docs/LEVEL_VARIANTS.md', import.meta.url), 'utf8')
for (const invariant of ['Level\n└─ Variant\n   └─ Version', 'Nerfed', '10K', 'SHA-256', 'Rating and clears']) {
  if (!docs.includes(invariant)) throw new Error(`Variant semantics documentation missing: ${invariant}`)
}

console.log('LEVEL VARIANT STATIC SMOKE PASSED')
console.log('Level -> Variant -> Version with legacy primary-Variant compatibility')
