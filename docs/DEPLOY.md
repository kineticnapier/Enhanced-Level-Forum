# Cloudflare production deployment

ELF production consists of three Cloudflare Workers plus an external PostgreSQL database:

```text
forum.example.com  -> enhanced-level-forum-web    (React SPA / Static Assets)
admin.example.com  -> enhanced-level-forum-admin  (React SPA / Static Assets)
api.example.com    -> enhanced-level-forum-api    (Hono Worker)
                                              |
                                              v
                                      Hyperdrive -> PostgreSQL
```

The deployment tooling intentionally keeps real domains, database credentials, the rate-limit salt, and the initial ADMIN password out of Git.

## Requirements

- Node.js 20+
- npm dependencies installed
- a Cloudflare account with a zone containing the three intended sibling subdomains
- Wrangler authenticated to that account
- a remotely reachable PostgreSQL database supported by Hyperdrive
- all three production origins on sibling HTTPS hosts under the same site

Production uses a host-only `__Host-elf_session` cookie with `SameSite=Lax`; the public/admin/API hosts therefore need to remain same-site.

## 1. Create local production configuration

From the repository root:

```powershell
Copy-Item .env.production.example .env.production
```

Edit `.env.production`:

```dotenv
ELF_PUBLIC_ORIGIN=https://forum.example.com
ELF_ADMIN_ORIGIN=https://admin.example.com
ELF_API_ORIGIN=https://api.example.com

DATABASE_URL=postgres://USER:PASSWORD@HOST:5432/adoforum?sslmode=require

# Empty on first setup; production:setup fills this after creating Hyperdrive.
ELF_HYPERDRIVE_ID=
ELF_HYPERDRIVE_NAME=enhanced-level-forum-db

# 32+ characters; use a high-entropy random secret.
AUTH_RATE_LIMIT_SALT=

ELF_ADMIN_EMAIL=admin@example.com
ELF_ADMIN_NAME=ELF Administrator
ELF_ADMIN_PASSWORD=
```

`.env.production` is gitignored. Do not commit it or copy its values into tracked Wrangler files.

## 2. First-time Cloudflare/database setup

Run:

```powershell
npm run production:setup
```

The command:

1. validates the production origins and secret requirements;
2. runs `wrangler whoami` so an account/login failure happens before any database mutation;
3. creates the Hyperdrive configuration when `ELF_HYPERDRIVE_ID` is empty;
4. stores the returned Hyperdrive ID back into the gitignored `.env.production`;
5. applies all pending PostgreSQL migrations using `DATABASE_URL`;
6. creates the initial ADMIN when `ELF_ADMIN_EMAIL` and `ELF_ADMIN_PASSWORD` are supplied;
7. generates gitignored production Wrangler configs for API/public/admin.

The PostgreSQL connection string is redacted from the setup command log. Wrangler still receives it directly for Hyperdrive creation.

Production ignores `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_PASSWORD`; the initial ADMIN is created out-of-band in the database.

If Hyperdrive already exists, put its ID into `ELF_HYPERDRIVE_ID` before running setup and creation is skipped.

## 3. Generated Wrangler configuration

`production:setup` and `production:deploy` generate:

```text
apps/api/wrangler.production.generated.json
apps/web/wrangler.production.generated.json
apps/admin/wrangler.production.generated.json
```

They are ignored by Git and recreated from `.env.production`.

The API production config includes:

- `ENVIRONMENT=production`;
- exact `WEB_ORIGIN` and `ADMIN_ORIGIN` values;
- the `HYPERDRIVE` binding;
- `AUTH_RATE_LIMIT_SALT` as a required Worker secret;
- a Custom Domain route for the API hostname;
- `workers_dev=false`.

The frontend configs use Workers Static Assets with `not_found_handling: "single-page-application"`, Custom Domain routes, and `workers_dev=false`.

## 4. Deploy all three Workers

Run:

```powershell
npm run production:deploy
```

The deployment command:

1. validates `.env.production` and regenerates all production Wrangler configs;
2. builds shared/API code;
3. deploys the API with `AUTH_RATE_LIMIT_SALT` supplied through Wrangler's `--secrets-file` mechanism;
4. builds both React frontends with `VITE_API_URL=<ELF_API_ORIGIN>/api`;
5. deploys public and admin Static Asset Workers;
6. removes the temporary local Worker-secret file in a `finally` block.

The generated Custom Domain configuration lets Cloudflare create/manage the DNS records and certificates for the Worker hosts. The hostnames must belong to a zone available in the authenticated Cloudflare account.

## 5. Live production smoke test

After DNS/certificates are active:

```powershell
npm run production:smoke
```

The smoke test checks:

- API `/api/health` and database connectivity;
- public and admin frontends return HTML;
- the public Level catalog responds;
- an untrusted browser Origin is rejected with 403;
- both configured frontend origins receive the expected credentialed CORS preflight response;
- when production ADMIN credentials remain present locally, login succeeds and the cookie is `__Host-elf_session; Secure; HttpOnly; SameSite=Lax; Path=/` with no `Domain` attribute;
- the authenticated `/api/auth/me` session resolves as ADMIN.

Expected final marker:

```text
PRODUCTION DEPLOY SMOKE PASSED
```

After smoke succeeds, remove `ELF_ADMIN_PASSWORD` from `.env.production` if it is no longer needed for repeated smoke tests. The database contains only its password hash.

## 6. Re-deployment

Normal code deployments do not need to recreate Hyperdrive or the ADMIN:

```powershell
git pull
npm install
npm test
npm run production:deploy
npm run production:smoke
```

If a new DB migration was added, run it against production before deploying code that requires it:

```powershell
$env:DATABASE_URL="<production connection string>"
npm run db:migrate
Remove-Item Env:DATABASE_URL
```

Alternatively, rerunning `npm run production:setup` is idempotent for already-applied migrations and an already-existing active ADMIN.

## 7. Cloudflare Access for admin

`admin.example.com` may additionally be protected with Cloudflare Access. This is defense-in-depth only: the API continues to enforce ELF roles and must not rely on Access as application authorization.

## 8. Failure/recovery notes

### Hyperdrive creation succeeded but ID parsing failed

The setup command prints Wrangler's output. Copy the returned Hyperdrive ID into:

```dotenv
ELF_HYPERDRIVE_ID=<id>
```

Then rerun `npm run production:setup`. It will not create another Hyperdrive.

### Custom Domain deploy fails

Confirm the three hostnames are in a Cloudflare zone available to the currently authenticated Wrangler account. No application DNS records need to be committed to the repository.

### API deploy succeeds but browser login fails

Check that:

- all three URLs in `.env.production` are exact HTTPS origins;
- the frontend was built by `production:deploy`, not an older local build;
- `AUTH_RATE_LIMIT_SALT` was uploaded;
- `/api/health` reports `database:true`;
- public/admin/API are sibling same-site hosts.

### Database migration fails

Do not deploy the API until the migration succeeds. Fix the production `DATABASE_URL`, rerun `npm run production:setup` or `npm run db:migrate`, and then deploy.

## Local development remains separate

The checked-in `apps/*/wrangler.jsonc` files remain development-oriented. `npm run dev:api`, `npm run dev:web`, and `npm run dev:admin` continue to use localhost configuration. Production commands use only the generated `wrangler.production.generated.json` files.

Do not replace the local Hyperdrive placeholder with a production ID in the tracked development config.
