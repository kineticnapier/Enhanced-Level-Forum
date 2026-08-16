import { access, readFile } from 'node:fs/promises'

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
    'document.documentElement.lang = locale',
    'LanguageSwitch',
  ]) {
    if (!source.includes(invariant)) throw new Error(`${name} i18n invariant missing: ${invariant}`)
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

for (const path of [
  '../README.en.md',
  '../docs/en/API.md',
  '../docs/en/ARCHITECTURE.md',
  '../docs/en/DEPLOY.md',
  '../docs/en/SECURITY.md',
]) {
  await access(new URL(path, import.meta.url))
}

console.log('I18N STATIC SMOKE PASSED')
console.log('Japanese/English UI -> browser detection -> persisted selector -> Japanese docs + English mirrors')
