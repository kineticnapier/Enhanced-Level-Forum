# Build fix 0.2.3

TypeScript did not know Vite's `import.meta.env` shape in the public frontend.

Added `src/env.d.ts` to both `apps/web` and `apps/admin`:

```ts
interface ImportMetaEnv {
  readonly VITE_API_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
```

This intentionally declares only the environment variable currently consumed by AdoForum and does not rely on ambient Vite client declarations.
