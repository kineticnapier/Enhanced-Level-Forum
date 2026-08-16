# Cloudflare deployment

The project is designed for three Worker deployments plus PostgreSQL.

## 1. Install and migrate the database

```powershell
npm install
$env:DATABASE_URL="postgres://USER:PASSWORD@HOST:5432/adoforum?sslmode=require"
npm run db:migrate
```

`004_auth_hardening.sql` must be applied before deploying the production-auth API because login/session loading expects the new account-state columns and login-attempt table.

## 2. Create the first production ADMIN

Production intentionally ignores the development bootstrap credentials.

With `DATABASE_URL` still pointing at the production database:

```powershell
$env:ELF_ADMIN_PASSWORD="use-a-long-unique-password"
npm run auth:create-admin -- --email admin@example.com --name "ELF Admin"
Remove-Item Env:ELF_ADMIN_PASSWORD
```

The script is safe against accidental silent promotion/reactivation: if that email already belongs to a non-active-ADMIN account, it refuses and leaves the row unchanged.

## 3. Create Hyperdrive

From the repository root:

```powershell
npx wrangler hyperdrive create enhanced-level-forum-db --connection-string="$env:DATABASE_URL"
```

Copy the returned Hyperdrive ID into `apps/api/wrangler.jsonc` under the `HYPERDRIVE` binding.

Cloudflare recommends `pg`/node-postgres for Hyperdrive and Workers; this project enables `nodejs_compat` and uses a current compatibility date.

## 4. Configure API production vars and secrets

Set the intended origins in the production Wrangler configuration/environment:

```jsonc
"vars": {
  "ENVIRONMENT": "production",
  "WEB_ORIGIN": "https://forum.example.com",
  "ADMIN_ORIGIN": "https://admin.example.com"
}
```

Do **not** set a cookie domain. Production sessions use a host-only `__Host-elf_session` cookie scoped to the API host.

Create a high-entropy rate-limit salt as a Worker secret:

```powershell
cd apps/api
npx wrangler secret put AUTH_RATE_LIMIT_SALT
cd ../..
```

`BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_PASSWORD` are development-only and should not be configured in production.

## 5. Configure frontend API URL

Before building/deploying each frontend, set:

```powershell
$env:VITE_API_URL="https://api.example.com/api"
```

or put the value in the frontend deployment environment.

## 6. Deploy

```powershell
npm run deploy:api
npm run deploy:web
npm run deploy:admin
```

Each deployment works initially on its `workers.dev` address. For a real production test, set `WEB_ORIGIN` / `ADMIN_ORIGIN` to the exact frontend origins actually used; browser writes from any other origin are rejected with 403.

## 7. Custom domains

For production, attach custom domains such as:

- `forum.example.com` -> `enhanced-level-forum-web`
- `admin.example.com` -> `enhanced-level-forum-admin`
- `api.example.com` -> `enhanced-level-forum-api`

You can add them in Cloudflare Dashboard or add Wrangler `routes` with `custom_domain: true`.

## 8. Production smoke path

Before enabling scheduled jobs, verify at least:

1. `GET https://api.example.com/api/health` reports database healthy.
2. production ADMIN can log in;
3. `GET /api/auth/me` returns that account;
4. create a temporary non-admin user with a 12+ character password;
5. role change revokes that user's existing session;
6. disabling the account prevents re-login;
7. browser writes from an unlisted `Origin` receive 403;
8. public Level/Reference/proposal reads still work.

Only after this path is stable should the TUF Cron Trigger be enabled.

## 9. Optional Cloudflare Access

Protect `admin.example.com` with Cloudflare Access if desired. Keep backend roles enabled regardless. Cloudflare Access is an additional perimeter, not a replacement for ELF role checks.

## Local Hyperdrive

Local development does not commit a database password in `wrangler.jsonc`. Run `npm run setup:local` once, then use `npm run dev:api`. The root wrapper reads `.env` and sets `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` automatically.

You may still override that environment variable explicitly when testing a different local database.
