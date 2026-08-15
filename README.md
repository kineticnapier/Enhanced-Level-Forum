# Enhanced Level Forum (ELF)

Current development version: **v0.3.0**

Enhanced Level Forum is an ADOFAI difficulty forum/database built around versioned level data, auditable rating history, rerating proposals, and reviewable References.

```text
forum.example.com  -> apps/web    React/Vite public frontend
admin.example.com  -> apps/admin  React/Vite staff frontend
api.example.com    -> apps/api    Hono Cloudflare Worker
                                      |
                                      v
                               Hyperdrive -> PostgreSQL
```

PostgreSQL is the source of truth. The frontends are disposable static deployments; the API is the only writer.

## Rating model

ELF deliberately does **not** publish a 100-step `G9 Mid-High` style official scale.

- Canonical rating: integer `P/G/U` tier such as `G9`.
- Human evidence: integer anchor tier + a five-step lean `-2..2`.
- The lean may be aggregated internally, but never silently becomes a canonical decimal rating.
- Reference `position_hint` uses the same coarse scale only as descriptive metadata.

## Data rules

1. `Level` and `LevelVersion` are separate. SHA-256 belongs to a version.
2. Canonical ratings are historical rows; publishing a rerate closes the previous current row.
3. Reference charts may be rerated. A mismatch marks the Reference `NEEDS_REVIEW` instead of blocking the rerate.
4. Community votes, canonical decisions, external imports and Analyzer predictions remain separate datasets.
5. TUF / Clastar Galaxy imports are raw observations until a human workflow promotes a decision.
6. Administrative writes are audited.

## Fresh local setup

Requirements:

- Node.js 20+
- PostgreSQL server
- Git

A Cloudflare account is **not** required for local development.

```powershell
git clone https://github.com/kineticnapier/Enhanced-Level-Forum.git
cd Enhanced-Level-Forum
npm install
npm run setup:local
```

`setup:local` is idempotent. It:

- creates `.env` from `.env.example` if needed;
- creates `apps/api/.dev.vars`, `apps/web/.env.local`, and `apps/admin/.env.local` from their examples without overwriting existing files;
- connects to PostgreSQL;
- creates the database if it does not exist;
- applies all pending migrations.

The default connection is:

```text
postgres://postgres:postgres@127.0.0.1:5432/adoforum
```

The database is still named `adoforum` internally for compatibility with existing development databases. The project/product name is ELF.

If your PostgreSQL password is not `postgres`, set the connection before the first setup run:

```powershell
$env:DATABASE_URL="postgres://postgres:<PASSWORD>@127.0.0.1:5432/adoforum"
npm run setup:local
```

The generated `.env` is ignored by Git. Later shells do not need to export `DATABASE_URL`; the development and migration scripts read `.env` automatically.

If PostgreSQL authentication fails, edit `.env` and rerun `npm run setup:local`.

## Run locally

Open three terminals in the repository root:

```powershell
npm run dev:api
```

```powershell
npm run dev:web
```

```powershell
npm run dev:admin
```

Open:

- Public: `http://localhost:5173`
- Admin: `http://localhost:5174`
- API health: `http://localhost:8787/api/health`

Expected health response:

```json
{"ok":true,"database":true,"version":"0.3.0"}
```

Use `localhost` consistently for browser-facing services. Do not mix it with `127.0.0.1`; the local session cookie is `SameSite=Lax`.

The root `dev:api` command reads `DATABASE_URL` from `.env` and automatically supplies it to Wrangler's local Hyperdrive binding. Database passwords therefore do not need to be committed to `wrangler.jsonc`.

## Bootstrap admin

`npm run setup:local` creates `apps/api/.dev.vars` from the checked-in example if the file is missing.

The initial example credentials are development-only:

```text
Email:    admin@example.com
Password: change-me-immediately
```

The bootstrap account is created only when a login exactly matches `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` and that email is not already present in the database. Change/remove the bootstrap credentials before a public deployment.

## Tests

Static/build checks:

```powershell
npm test
```

DB/API integration smoke test:

```powershell
# terminal 1
npm run dev:api

# terminal 2
npm run test:e2e
```

The E2E test creates a unique temporary ADMIN user and level, then verifies:

```text
login
 -> create level/version
 -> publish G9
 -> add ACTIVE G9 reference
 -> rerate to G10
 -> reference becomes NEEDS_REVIEW
 -> create proposal
 -> approve proposal
 -> audit entry exists
```

The temporary level/user and their audit rows are removed afterward, including when the test fails after creation.

## Existing checkout

```powershell
git pull
npm install
npm run setup:local
npm test
```

`setup:local` does not overwrite existing local secrets/config files and safely skips already-applied migrations.

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
  setup-local.mjs
  apply-migrations.mjs
  dev-api.mjs
  smoke.mjs
  e2e-smoke.mjs
docs/
  ARCHITECTURE.md
  DEPLOY.md
  API.md
  SECURITY.md
```

## Production deployment

See `docs/DEPLOY.md` for Hyperdrive, production secrets, CORS origins and custom domains.
