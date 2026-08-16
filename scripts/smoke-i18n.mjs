import { access, readFile, readdir } from 'node:fs/promises'

const publicMain = await readFile(new URL('../apps/web/src/main.tsx', import.meta.url), 'utf8')
const publicI18n = await readFile(new URL('../apps/web/src/i18n.tsx', import.meta.url), 'utf8')
const adminMain = await readFile(new URL('../apps/admin/src/main.tsx', import.meta.url), 'utf8')
const adminI18n = await readFile(new URL('../apps/admin/src/i18n.tsx', import.meta.url), 'utf8')
const reconciliation = await readFile(new URL('../apps/admin/src/TufReconciliation.tsx', import.meta.url), 'utf8')
const evidence = await readFile(new URL('../apps/admin/src/TufEvidenceProposals.tsx', import.meta.url), 'utf8')

for (const [name, source] of [['public', publicI18n], ['admin', adminI18n]]) {
  for (const invariant of [
    "export type Locale = 'ja' | 'en'",
    "localStorage.getItem('elf_locale')",
    "navigator.language.toLowerCase().startsWith('ja')",
    'Intl.DateTimeFormat',
    'LanguageSwitch',
  ]) {
    if (!source.includes(invariant)) throw new Error(`${name} i18n invariant missing: ${invariant}`)
  }
  const compact = source.replace(/\s+/g, '')
  if (!compact.includes('document.documentElement.lang=locale')) {
    throw new Error(`${name} i18n invariant missing: document.documentElement.lang = locale`)
  }
  for (const label of ['基準譜面', '難易度変更', '要確認']) {
    if (!source.includes(label)) throw new Error(`${name} Japanese terminology missing: ${label}`)
  }
}

for (const [name, source] of [['public', publicMain], ['admin', adminMain]]) {
  if (!source.includes('<I18nProvider>')) throw new Error(`${name} app is not wrapped in I18nProvider`)
  if (!source.includes('<LanguageSwitch')) throw new Error(`${name} app does not expose a language switch`)
}

for (const [name, source] of [['TUF reconciliation', reconciliation], ['TUF evidence', evidence]]) {
  if (!source.includes('useI18n')) throw new Error(`${name} is not localized`)
}

const readmeJa = await readFile(new URL('../README.md', import.meta.url), 'utf8')
const readmeEn = await readFile(new URL('../README.en.md', import.meta.url), 'utf8')
if (!readmeJa.includes('[English](README.en.md)')) throw new Error('Japanese README is missing the English link')
if (!readmeEn.includes('[日本語](README.md)')) throw new Error('English README is missing the Japanese link')

const docsDir = new URL('../docs/', import.meta.url)
const docs = (await readdir(docsDir, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
  .map((entry) => entry.name)
  .sort()

if (!docs.length) throw new Error('no Japanese docs found')
for (const file of docs) {
  const japanese = await readFile(new URL(`../docs/${file}`, import.meta.url), 'utf8')
  const englishUrl = new URL(`../docs/en/${file}`, import.meta.url)
  await access(englishUrl)
  const english = await readFile(englishUrl, 'utf8')
  if (!japanese.includes(`[English](en/${file})`)) throw new Error(`${file}: Japanese document is missing the English link`)
  if (!english.includes(`[日本語](../${file})`)) throw new Error(`${file}: English document is missing the Japanese link`)
}

console.log('I18N STATIC SMOKE PASSED')
console.log(`Japanese/English UI + ${docs.length} mirrored docs -> browser detection -> persisted selector -> reciprocal language links`)
