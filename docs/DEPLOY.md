# Cloudflare production deployment

ELF production consists of three Cloudflare Workers plus an external PostgreSQL database. A purchased/custom domain is **not required** for the initial deployment.

The default deployment mode uses the account's `workers.dev` subdomain:

```text
enhanced-level-forum-web.<account>.workers.dev    -> public React SPA
enhanced-level-forum-admin.<account>.workers.dev  -> staff React SPA
enhanced-level-forum-api.<account>.workers.dev    -> Hono API Worker
                                                       |
                                                       v
                                               Hyperdrive -> PostgreSQL
```

Later, the same deployment can be moved to custom sibling domains without recreating the database or Hyperdrive.

The deployment tooling keeps the database credentials, rate-limit salt, initial ADMIN password, and generated Wrangler configs out of Git.

## Requirements

- Node.js 20+
- npm dependencies installed
- a Cloudflare account with Workers enabled
- Wrangler authenticated to that account
- a remotely reachable PostgreSQL database supported by Hyperdrive
- the account's `workers.dev` subdomain label for the default mode

Cloudflare assigns each Worker a URL of the form `<worker-name>.<account-subdomain>.workers.dev` when `workers_dev` is enabled. All three ELF Workers use fixed names, so their origins can be derived before deployment.

Production uses a host-only `__Host-elf_session` cookie with `SameSite=Lax`. Public/admin/API therefore remain sibling HTTPS hosts under the same site in both deployment modes.

## 1. Create local production configuration

From the repository root:

```powershell
Copy-Item .env.production.example .env.production
```

For a domainless first deployment, edit `.env.production` like this:

```dotenv
ELF_DEPLOY_MODE=workers_dev
ELF_WORKERS_DEV_SUBDOMAIN=your-account-subdomain

# Leave these empty in workers_dev mode.
ELF_PUBLIC_ORIGIN=
ELF_ADMIN_ORIGIN=
ELF_API_ORIGIN=

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

If the Cloudflare dashboard shows the account URL as:

```text
https://hello.workers.dev
```

then use:

```dotenv
ELF_WORKERS_DEV_SUBDOMAIN=hello
```

The loader also accepts `hello.workers.dev` and normalizes it to the same account label.

`.env.production` is gitignored. Do not commit it or copy its secret values into tracked Wrangler files.

## 2. First-time Cloudflare/database setup

Run:

```powershell
npm run production:setup
```

The command:

1. validates the deployment mode and derived/explicit origins;
2. runs `wrangler whoami` so an account/login failure happens before database mutation;
3. creates Hyperdrive when `ELF_HYPERDRIVE_ID` is empty;
4. stores the returned Hyperdrive ID in the gitignored `.env.production`;
5. applies all pending PostgreSQL migrations;
6. creates the initial ADMIN when credentials are supplied;
7. generates gitignored production Wrangler configs for API/public/admin.

In `workers_dev` mode, setup prints the three derived URLs. No Cloudflare DNS zone or purchased domain is required.

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

### workers.dev mode

For `ELF_DEPLOY_MODE=workers_dev`:

- all three configs use `workers_dev=true`;
- no Custom Domain `routes` are emitted;
- Preview URLs are disabled separately with `preview_urls=false`;
- API CORS origins are the derived public/admin `workers.dev` URLs;
- frontends are built against the derived API `workers.dev` URL.

### Custom Domain mode

For `ELF_DEPLOY_MODE=custom_domain`:

- `ELF_PUBLIC_ORIGIN`, `ELF_ADMIN_ORIGIN`, and `ELF_API_ORIGIN` are required;
- they must be sibling HTTPS origins;
- generated configs use Custom Domain routes;
- `workers_dev=false` and `preview_urls=false`.

The API config always includes `ENVIRONMENT=production`, the `HYPERDRIVE` binding, observability, and `AUTH_RATE_LIMIT_SALT` as a required secret. Frontend configs always use Workers Static Assets with SPA fallback.

## 4. Deploy all three Workers

Run:

```powershell
npm run production:deploy
```

The deployment command:

1. validates `.env.production` and regenerates all production Wrangler configs;
2. builds shared/API code;
3. deploys the API with `AUTH_RATE_LIMIT_SALT` supplied through Wrangler's secrets-file mechanism;
4. builds both React frontends with `VITE_API_URL=<ELF_API_ORIGIN>/api`;
5. deploys public and admin Static Asset Workers;
6. removes the temporary local Worker-secret file in a `finally` block.

In workers.dev mode the resulting public URLs are deterministic from the Worker names and account subdomain, for example:

```text
https://enhanced-level-forum-web.hello.workers.dev
https://enhanced-level-forum-admin.hello.workers.dev
https://enhanced-level-forum-api.hello.workers.dev
```

## 5. Live production smoke test

After deployment:

```powershell
npm run production:smoke
```

The smoke test checks:

- API `/api/health` and database connectivity;
- public and admin frontends return HTML;
- the public Level catalog responds;
- an untrusted browser Origin is rejected with 403;
- both configured frontend origins receive credentialed CORS preflight responses;
- when production ADMIN credentials remain present locally, login succeeds and the cookie is `__Host-elf_session; Secure; HttpOnly; SameSite=Lax; Path=/` with no `Domain` attribute;
- authenticated `/api/auth/me` resolves as ADMIN.

Expected final marker:

```text
PRODUCTION DEPLOY SMOKE PASSED
```

After smoke succeeds, remove `ELF_ADMIN_PASSWORD` from `.env.production` if it is no longer needed for repeated login smoke tests. The database contains only its password hash.

## 6. Move to a custom domain later

Buying a domain later does not require a new ELF database, a new ADMIN, or a new Hyperdrive configuration.

Add the domain to the Cloudflare account, then change `.env.production`:

```dotenv
ELF_DEPLOY_MODE=custom_domain
ELF_PUBLIC_ORIGIN=https://forum.example.com
ELF_ADMIN_ORIGIN=https://admin.example.com
ELF_API_ORIGIN=https://api.example.com
```

Keep the existing `DATABASE_URL`, `ELF_HYPERDRIVE_ID`, and secrets, then run:

```powershell
npm run production:deploy
npm run production:smoke
```

The generated Wrangler configs will switch from `workers_dev=true` with no routes to Custom Domain routes with `workers_dev=false`.

Do not leave old `workers.dev` origins in the frontend build manually; `production:deploy` rebuilds both frontends against the new API origin.

## 7. Re-deployment

Normal code deployments do not recreate Hyperdrive or the ADMIN:

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

## 8. Cloudflare Access for admin

A custom-domain admin frontend may additionally be protected with Cloudflare Access. This is defense-in-depth only: the API continues to enforce ELF roles and must not rely on Access as application authorization.

## 9. Failure/recovery notes

### I do not own a domain

Use the default:

```dotenv
ELF_DEPLOY_MODE=workers_dev
ELF_WORKERS_DEV_SUBDOMAIN=<your Cloudflare account subdomain>
```

No Custom Domain route is generated.

### Hyperdrive creation succeeded but ID parsing failed

The setup command prints Wrangler's output. Copy the returned Hyperdrive ID into:

```dotenv
ELF_HYPERDRIVE_ID=<id>
```

Then rerun `npm run production:setup`. It will not create another Hyperdrive.

### workers.dev deploy URL is wrong

Check the account's Workers & Pages subdomain. `ELF_WORKERS_DEV_SUBDOMAIN` is the account label only, not a Worker name. For `hello.workers.dev`, use `hello`.

The Worker names are fixed by ELF and are prepended automatically.

### Custom Domain deploy fails

Confirm `ELF_DEPLOY_MODE=custom_domain` and that all three hostnames belong to a Cloudflare zone available to the authenticated Wrangler account.

### API deploy succeeds but browser login fails

Check that:

- all three derived/explicit URLs are HTTPS and sibling same-site hosts;
- the frontend was built by `production:deploy`, not an older local build;
- `AUTH_RATE_LIMIT_SALT` was uploaded;
- `/api/health` reports `database:true`;
- in workers.dev mode, all three Workers use the same account subdomain.

### Database migration fails

Do not deploy the API until the migration succeeds. Fix the production `DATABASE_URL`, rerun `npm run production:setup` or `npm run db:migrate`, and then deploy.

## Local development remains separate

The checked-in `apps/*/wrangler.jsonc` files remain development-oriented. `npm run dev:api`, `npm run dev:web`, and `npm run dev:admin` continue to use localhost configuration. Production commands use only the generated `wrangler.production.generated.json` files.

Do not replace the local Hyperdrive placeholder with a production ID in the tracked development config.
