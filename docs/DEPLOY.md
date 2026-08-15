# Cloudflare deployment

The project is designed for three Worker deployments plus PostgreSQL.

## 1. Install and migrate the database

```powershell
npm install
$env:DATABASE_URL="postgres://USER:PASSWORD@HOST:5432/adoforum?sslmode=require"
npm run db:migrate
```

## 2. Create Hyperdrive

From the repository root:

```powershell
npx wrangler hyperdrive create enhanced-level-forum-db --connection-string="$env:DATABASE_URL"
```

Copy the returned Hyperdrive ID into `apps/api/wrangler.jsonc` under the `HYPERDRIVE` binding.

Cloudflare recommends `pg`/node-postgres for Hyperdrive and Workers; this project enables `nodejs_compat` and uses a current compatibility date.

## 3. Configure API production origins

Change the API Wrangler vars to the intended domains, for example:

```jsonc
"vars": {
  "ENVIRONMENT": "production",
  "WEB_ORIGIN": "https://forum.example.com",
  "ADMIN_ORIGIN": "https://admin.example.com",
  "COOKIE_DOMAIN": ".example.com"
}
```

Set bootstrap credentials as Worker secrets:

```powershell
cd apps/api
npx wrangler secret put BOOTSTRAP_ADMIN_EMAIL
npx wrangler secret put BOOTSTRAP_ADMIN_PASSWORD
cd ../..
```

## 4. Configure frontend API URL

Before building/deploying each frontend, set:

```powershell
$env:VITE_API_URL="https://api.example.com/api"
```

or put the value in the frontend deployment environment.

## 5. Deploy

```powershell
npm run deploy:api
npm run deploy:web
npm run deploy:admin
```

Each deployment works initially on its `workers.dev` address.

## 6. Custom domains

For production, attach custom domains such as:

- `forum.example.com` -> `enhanced-level-forum-web`
- `admin.example.com` -> `enhanced-level-forum-admin`
- `api.example.com` -> `enhanced-level-forum-api`

You can add them in Cloudflare Dashboard or add Wrangler `routes` with `custom_domain: true`.

## 7. Optional Cloudflare Access

Protect `admin.example.com` with Cloudflare Access if desired. Keep backend roles enabled regardless.

## Local Hyperdrive

Local development does not commit a database password in `wrangler.jsonc`. Run `npm run setup:local` once, then use `npm run dev:api`. The root wrapper reads `.env` and sets `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` automatically.

You may still override that environment variable explicitly when testing a different local database.
