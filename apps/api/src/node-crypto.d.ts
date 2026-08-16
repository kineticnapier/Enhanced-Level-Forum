declare module 'node:crypto' {
  export function pbkdf2(
    password: string | Uint8Array,
    salt: string | Uint8Array,
    iterations: number,
    keylen: number,
    digest: string,
    callback: (error: Error | null, derivedKey: Uint8Array) => void,
  ): void

  export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean
}
