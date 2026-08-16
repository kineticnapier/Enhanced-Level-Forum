import { pbkdf2 as nodePbkdf2, timingSafeEqual } from 'node:crypto'

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

function pbkdf2Sha256(password: string, salt: Uint8Array, iterations: number, keyLength: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    nodePbkdf2(password, salt, iterations, keyLength, 'sha256', (error, derivedKey) => {
      if (error) reject(error)
      else resolve(new Uint8Array(derivedKey))
    })
  })
}

export function randomToken(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength)
  crypto.getRandomValues(bytes)
  return toBase64Url(bytes)
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function hashPassword(password: string): Promise<string> {
  const iterations = 210_000
  const salt = new Uint8Array(16)
  crypto.getRandomValues(salt)
  const bits = await pbkdf2Sha256(password, salt, iterations, 32)
  return `pbkdf2-sha256$${iterations}$${toBase64Url(salt)}$${toBase64Url(bits)}`
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, iterationText, saltText, hashText] = encoded.split('$')
  if (algorithm !== 'pbkdf2-sha256' || !iterationText || !saltText || !hashText) return false
  const iterations = Number(iterationText)
  if (!Number.isInteger(iterations) || iterations < 100_000) return false
  const salt = fromBase64Url(saltText)
  const expected = fromBase64Url(hashText)
  const actual = await pbkdf2Sha256(password, salt, iterations, expected.byteLength)
  if (actual.byteLength !== expected.byteLength) return false
  return timingSafeEqual(actual, expected)
}
