# v0.2.1 ビルド修正

[English](en/BUILD_FIX_0.2.1.md)

Windowsで `npm run build` を実行した際に報告された TypeScript 5.8 のエラーを修正したパッチです。

1. `crypto.ts`: base64urlデコード後の `Uint8Array<ArrayBufferLike>` が PBKDF2 salt の WebCrypto `BufferSource` として受理されませんでした。デコード済みsaltを所有する `ArrayBuffer` へコピーしてから `deriveBits` に渡すよう変更しました。
2. `index.ts`: JSON parse失敗時のfallbackが `{}` を返していたため、unionにより `email` / `password` が見えなくなっていました。fallbackをログインbodyと同じ型にしました。

ビルド環境での確認:

- `npm run smoke` → 成功
- TypeScript 5.8.3 の対象箇所strict check → エラーなし
- ビルド環境からnpm registryへ到達できず全workspace buildは未実施。ローカルで `npm install` と `npm run build` を実行してください。
