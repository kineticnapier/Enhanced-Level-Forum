# Enhanced Level Forum (ELF)

Current development version: **v0.2.5**

Enhanced Level Forum is an ADOFAI difficulty forum/database built around versioned level data, auditable rating history, rerating proposals, and non-sacred References.

The application is split into three independently deployable pieces:

```text
forum.example.com  -> apps/web    React/Vite public frontend
admin.example.com  -> apps/admin  React/Vite staff frontend
api.example.com    -> apps/api    Hono Cloudflare Worker
                                      |
                                      v
                               Hyperdrive -> PostgreSQL
```

PostgreSQL is the source of truth. Frontend deployments are disposable static builds; the API is the only writer.

## Rating model

ELF deliberately does **not** publish a 100-step `G9 Mid-High` style official scale.

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

## Fresh local setup

The following example is for Windows / PowerShell.

Requirements:

- Node.js 20+ (22 recommended)
- PostgreSQL, including the `psql` command-line tools
- Git
- A Cloudflare account is **not** required for local UI/API development

### 1. Clone and install dependencies

```powershell
git clone https://github.com/kineticnapier/Enhanced-Level-Forum.git
cd Enhanced-Level-Forum
npm install
```

### 2. Verify PostgreSQL

```powershell
psql --version
```

If `psql` is not found, add the PostgreSQL `bin` directory to `PATH`. A typical installation path is:

```text
C:\Program Files\PostgreSQL\18\bin
```

The version number may differ.

### 3. Create the local database

A fresh PostgreSQL installation does not contain the ELF database. Create it first:

```powershell
psql -U postgres -d postgres -c 'CREATE DATABASE adoforum;'
```

`psql` will ask for the password of the PostgreSQL `postgres` user.

The database is currently named `adoforum` internally for compatibility with the existing development configuration. It is only an internal database name and does not affect the ELF project name.

If the database already exists, skip this command.

### 4. Apply database migrations

Set the connection string for the migration script. Replace `<PASSWORD>` with the password chosen when PostgreSQL was installed:

```powershell
$env:DATABASE_URL="postgres://postgres:<PASSWORD>@127.0.0.1:5432/adoforum"
npm run db:migrate
```

A successful first migration should end with:

```text
apply 001_initial.sql
apply 002_seed_tags.sql
migrations complete
```

Later runs are safe; already-applied migrations are skipped.

### 5. Configure the API development secrets

```powershell
Copy-Item apps/api/.dev.vars.example apps/api/.dev.vars
Get-Content apps/api/.dev.vars
```

`.dev.vars` is ignored by Git and must not be committed.

The bootstrap admin is created only when the first login exactly matches `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_PASSWORD` from this file. Once a real admin account exists, change or remove the bootstrap credentials before deployment.

### 6. Configure the Worker's local database connection

The checked-in Wrangler config assumes the development connection string:

```text
postgres://postgres:postgres@127.0.0.1:5432/adoforum
```

If your PostgreSQL password is not `postgres`, override it for the current PowerShell session instead of committing your password to `wrangler.jsonc`:

```powershell
$env:CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE="postgres://postgres:<PASSWORD>@127.0.0.1:5432/adoforum"
```

Use the same database credentials for `DATABASE_URL` and the Hyperdrive local connection string.

### 7. Run the three development servers

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

- public: `http://localhost:5173`
- admin: `http://localhost:5174`
- API health: `http://localhost:8787/api/health`

A healthy local API/database connection returns approximately:

```json
{"ok":true,"database":true,"version":"0.2.5"}
```

Use `localhost` consistently for browser-facing services. Do not mix it with `127.0.0.1`, because the local session cookie uses `SameSite=Lax` and mixing hosts makes authenticated browser requests cross-site.

## Existing checkout: update and migrate

After pulling new commits:

```powershell
git pull
npm install
$env:DATABASE_URL="postgres://postgres:<PASSWORD>@127.0.0.1:5432/adoforum"
npm run db:migrate
```

Then restart the API/web/admin development servers.

## Build

```powershell
npm run build
npm run smoke
```

## Production deployment

See `docs/DEPLOY.md` for Hyperdrive, secrets, CORS origins and custom domains.

## Development notes

### PostgreSQL `REFERENCES` migration fix

PostgreSQL reserves `REFERENCES` as SQL syntax. An early migration used `references` as a table name, which failed with PostgreSQL error `42601`. The physical table is now named `difficulty_references`; public API routes remain `/api/references`.

### Local authentication host rule

For cookie authentication in local development, use `localhost` consistently for all three browser-facing services:

- Public: `http://localhost:5173`
- Admin: `http://localhost:5174`
- API: `http://localhost:8787`

Do not mix `localhost` and `127.0.0.1`. Login can otherwise appear successful while subsequent authenticated API calls return `401 Unauthorized`.
