# v0.2.1 build fix

This patch addresses the three TypeScript 5.8 errors reported by `npm run build` on Windows:

1. `crypto.ts`: `Uint8Array<ArrayBufferLike>` was rejected as a WebCrypto `BufferSource` for PBKDF2 salt after base64url decoding. The decoded salt is now copied into an owned `ArrayBuffer` before `deriveBits`.
2. `index.ts`: the JSON parse fallback returned `{}`, producing a union that hid `email` and `password`. The fallback now has the same typed shape as the login body.

Validation performed in the build environment:

- `npm run smoke` -> passed.
- TypeScript 5.8.3 isolated strict checks for both corrected typing cases -> passed with no errors.
- Full workspace build could not be run in the build environment because package installation cannot reach the npm registry; run `npm install` and `npm run build` locally.
