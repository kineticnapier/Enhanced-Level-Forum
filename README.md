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
- applies all pending migrations, including authentication hardening migrations.

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

## Local bootstrap admin

`npm run setup:local` creates `apps/api/.dev.vars` from the checked-in example if the file is missing.

The example credentials are development-only:

```text
Email:    admin@example.com
Password: change-me-immediately
```

The bootstrap account is created only when a local login exactly matches `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` and that email is not already present.

**`ENVIRONMENT=production` ignores bootstrap credentials completely.** Production administrators are created out-of-band after migrations:

```powershell
$env:DATABASE_URL="postgres://USER:PASSWORD@HOST:5432/adoforum?sslmode=require"
$env:ELF_ADMIN_PASSWORD="a-long-unique-password"
npm run auth:create-admin -- --email admin@example.com --name "ELF Admin"
Remove-Item Env:ELF_ADMIN_PASSWORD
```

See `docs/SECURITY.md` for login throttling, account disabling, session revocation and cookie rules.

## TUF importer

The TUF importer reads the public TUF v2 level search and Reference endpoints and stores the result as **external observations**. It does not create ELF Levels and it never writes ELF `canonical_ratings` or `difficulty_references`.

After applying migrations and starting the API:

```powershell
# terminal 1
npm run dev:api

# terminal 2
npm run import:tuf
```

For the default local bootstrap account, `import:tuf` reads the credentials from `apps/api/.dev.vars`. If the local admin uses different credentials:

```powershell
$env:ELF_ADMIN_EMAIL="your-admin@example.com"
$env:ELF_ADMIN_PASSWORD="your-password"
npm run import:tuf
```

The importer stores:

- the complete raw response in `import_snapshots`;
- one normalized row per external level in `external_level_observations`;
- TUF difficulty as `external_rating_observations`;
- TUF References as `external_reference_observations`;
- malformed/ambiguous/conflicting data in `import_issues`.

A TUF ID is linked to an existing ELF Level only when a mapping already exists, or when an incoming valid SHA-256 exactly matches an existing ELF `LevelVersion`. Special/non-PGU labels such as `Impossible` remain external labels and are not forced into P/G/U.

For deterministic/offline testing, pass a JSON fixture containing `{ "levels": [...], "references": [...] }`:

```powershell
npm run import:tuf -- .\path\to\tuf-fixture.json
```

## Authentication hardening

Production authentication adds:

- host-only `__Host-elf_session` cookies (`Secure`, `HttpOnly`, `SameSite=Lax`);
- exact browser-Origin checks for state-changing API calls;
- salted email/IP login throttling backed by PostgreSQL;
- active/disabled account state;
- password change and admin password reset with session revocation;
- session revocation on role changes;
- a guard against disabling/demoting the final active ADMIN;
- development-only bootstrap credentials;
- out-of-band production ADMIN creation.

Production requires the Worker secret `AUTH_RATE_LIMIT_SALT`.

## Tests

Static/build checks:

```powershell
npm test
```

DB/API integration tests require all current migrations:

```powershell
npm run setup:local

# terminal 1
npm run dev:api

# terminal 2
npm run test:e2e
```

The E2E suite covers the canonical workflow, TUF isolation/reconciliation/proposals, public governance UI APIs, Reference proposal execution, and production-auth behavior.

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
  create-admin.mjs
  dev-api.mjs
  import-tuf.mjs
  smoke.mjs
  e2e-smoke.mjs
docs/
  ARCHITECTURE.md
  DEPLOY.md
  API.md
  SECURITY.md
```

## Production deployment

See `docs/DEPLOY.md` for Hyperdrive, production secrets, CORS origins, the production administrator bootstrap, custom domains and the production smoke path.
