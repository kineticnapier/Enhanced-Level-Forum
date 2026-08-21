import { parseCookies } from '../apps/api/src/http'

const malformed = parseCookies('__Host-elf_session=%E0%A4%A; preference=hello%20world')
if ('__Host-elf_session' in malformed) {
  throw new Error('malformed percent-encoded session cookie must be ignored')
}
if (malformed.preference !== 'hello world') {
  throw new Error('a malformed cookie must not discard other valid cookies')
}

const valid = parseCookies('elf_session=abc%2F123; flag')
if (valid.elf_session !== 'abc/123') throw new Error('valid percent-encoded cookie must still decode')
if (valid.flag !== '') throw new Error('cookie without equals must keep the existing empty-value behavior')

console.log('AUTH COOKIE RUNTIME SMOKE PASSED')
