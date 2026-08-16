# Build fix 0.2.3

[English](en/BUILD_FIX_0.2.2.md)

公開フロントエンドで TypeScript が Vite の `import.meta.env` の型を認識していませんでした。

`apps/web` と `apps/admin` の両方に `src/env.d.ts` を追加しました。

```ts
interface ImportMetaEnv {
  readonly VITE_API_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
```

Enhanced Level Forum が現在利用する環境変数だけを明示的に宣言し、Vite clientのambient型宣言には依存しません。
