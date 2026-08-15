const encoder = new TextEncoder()

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '')
}

function fromBase64Url(value: string): Uint8Array {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  const binary = atob(padded)
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

// TypeScript 5.8's WebCrypto BufferSource types require an ArrayBuffer-backed
// view. Values reconstructed with Uint8Array.from() are typed as
// Uint8Array<ArrayBufferLike>, so make an owned ArrayBuffer copy before
// passing them to SubtleCrypto.
function ownedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

export function randomToken(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength)
  crypto.getRandomValues(bytes)
  return toBase64Url(bytes)
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function hashPassword(password: string): Promise<string> {
  const iterations = 210_000
  const salt = new Uint8Array(16)
  crypto.getRandomValues(salt)
  const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    keyMaterial,
    256,
  )
  return `pbkdf2-sha256$${iterations}$${toBase64Url(salt)}$${toBase64Url(new Uint8Array(bits))}`
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, iterationText, saltText, hashText] = encoded.split('$')
  if (algorithm !== 'pbkdf2-sha256' || !iterationText || !saltText || !hashText) return false
  const iterations = Number(iterationText)
  if (!Number.isInteger(iterations) || iterations < 100_000) return false
  const salt = fromBase64Url(saltText)
  const expected = fromBase64Url(hashText)
  const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: ownedArrayBuffer(salt), iterations },
    keyMaterial,
    expected.byteLength * 8,
  ))
  if (bits.byteLength !== expected.byteLength) return false
  let diff = 0
  for (let i = 0; i < bits.byteLength; i++) diff |= bits[i]! ^ expected[i]!
  return diff === 0
}
