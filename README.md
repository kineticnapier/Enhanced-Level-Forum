# AdoForum Cloudflare v0.2.5

Cloudflare-oriented rewrite of the AdoForum MVP.

The application is split into three independently deployable pieces:

```text
forum.example.com  -> apps/web    React/Vite public frontend
admin.example.com  -> apps/admin  React/Vite staff frontend
api.example.com    -> apps/api    Hono Cloudflare Worker
                                      |
                                      v
                               Hyperdrive -> PostgreSQL
```

The old single Node server is no longer the production architecture. PostgreSQL is the source of truth; frontend deployments are disposable static builds; the API is the only writer.

## Rating model in this version

AdoForum deliberately does **not** publish a 100-step `G9 Mid-High` style official scale.

- Canonical rating: integer `P/G/U` tier such as `G9`.
- Human evidence: integer anchor tier + a five-step lean `-2..2`.
- The lean can be aggregated internally (`G9 + slightly high`, etc.) but never silently becomes a canonical decimal rating.
- Reference `position_hint` uses the same coarse scale only as descriptive metadata.

This keeps human input coarse while preserving enough evidence to notice borderline rerates.

## Data rules

1. `Level` and `LevelVersion` are separate. SHA-256 belongs to a version.
2. Canonical ratings are historical rows; publishing a rerate closes the previous current row.
3. Reference charts may be rerated. A mismatch marks the old Reference `NEEDS_REVIEW` instead of blocking the rerate.
4. Community votes, canonical decisions, external imports and Analyzer predictions remain separate datasets.
5. TUF / Clastar Galaxy imports are raw observations until a human workflow promotes a decision.
6. Administrative writes are audited.

## Repository layout

```text
apps/
  api/       Hono Worker + Hyperdrive/Postgres
  web/       public React/Vite frontend
  admin/     staff React/Vite frontend
packages/
  shared/    shared types and rating semantics
db/
  migrations/
scripts/
  apply-migrations.mjs
  smoke.mjs
docs/
  ARCHITECTURE.md
  DEPLOY.md
  API.md
  SECURITY.md
```

## Local development

Requirements:

- Node.js 20+ (22 recommended)
- PostgreSQL
- a Cloudflare account is not required for local UI/API development

Install dependencies:

```powershell
npm install
```

Create a local database and apply migrations:

```powershell
$env:DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/adoforum"
npm run db:migrate
```

Copy the API dev secrets file:

```powershell
Copy-Item apps/api/.dev.vars.example apps/api/.dev.vars
```

The default Wrangler config points its local Hyperdrive connection at the same local PostgreSQL database.

Run three terminals:

```powershell
npm run dev:api
npm run dev:web
npm run dev:admin
```

Open:

- public: `http://127.0.0.1:5173`
- admin: `http://127.0.0.1:5174`
- API: `http://127.0.0.1:8787/api/health`

The bootstrap admin is created only when a login exactly matches `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` and the account does not already exist. Remove/change the bootstrap secret after the real admin exists.

## Build

```powershell
npm run build
npm run smoke
```

The container used to generate this artifact has no npm network access, so the included source was syntax/static-smoke checked here; run `npm install && npm run build` on a networked development machine before deployment.

## Production deployment

See `docs/DEPLOY.md` for Hyperdrive, secrets, CORS origins and custom domains.

## v0.2.3 build fix

- Fixed TypeScript 5.8 WebCrypto `BufferSource` typing when verifying PBKDF2 passwords.
- Fixed the login JSON fallback type so `email` / `password` remain known after `.catch()`.



## v0.2.3 build fix

Added explicit `ImportMetaEnv` declarations to both Vite frontends so `import.meta.env.VITE_API_URL` type-checks under strict TypeScript builds. The same fix is applied to the public web app and admin app to avoid the next workspace failing for the same reason.


## v0.2.5 migration fix

PostgreSQL reserves `REFERENCES` as SQL syntax. The initial migration previously used `references` as a table name, which fails with PostgreSQL error `42601`. The physical table is now named `difficulty_references`; public API routes remain `/api/references`. If v0.2.3 failed while applying `001_initial.sql`, the migration transaction was rolled back, so rerun `npm run db:migrate` with v0.2.5.

## Development auth host rule (v0.2.5)

For cookie authentication in local development, use `localhost` consistently for all three services:

- Public: `http://localhost:5173`
- Admin: `http://localhost:5174`
- API: `http://localhost:8787`

Do not mix `localhost` and `127.0.0.1`. The session cookie uses `SameSite=Lax`; mixing those hosts makes browser fetches cross-site, so login can appear successful while subsequent authenticated API calls return `401 Unauthorized`.
