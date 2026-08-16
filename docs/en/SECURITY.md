# Security notes

[日本語](../SECURITY.md) | **English**

## Authentication

- passwords are stored as PBKDF2-SHA256 hashes with a random salt;
- passwords accepted by account-management endpoints are 12..256 characters;
- session tokens are random and only SHA-256 hashes of them are stored in PostgreSQL;
- sessions expire after 14 days;
- changing a password revokes every other session for that user;
- an administrator password reset revokes every session for the target user;
- changing a role revokes existing sessions so the account must re-authenticate;
- disabling an account revokes sessions and `loadUser` ignores disabled accounts;
- the final active `ADMIN` cannot be disabled or demoted.

Production uses a host-only cookie named `__Host-elf_session` with `Secure`, `HttpOnly`, `SameSite=Lax`, and `Path=/`. The cookie deliberately has **no `Domain` attribute**. The public and admin frontends never need direct access to the session cookie; credentialed requests send it only to the API host.

Local development continues to use `elf_session` over HTTP.

## Browser-origin / CSRF boundary

For state-changing API requests (`POST`, `PUT`, `PATCH`, `DELETE`), a browser-supplied `Origin` must exactly match `WEB_ORIGIN` or `ADMIN_ORIGIN`. Disallowed origins receive 403 before a write route runs.

Requests with no `Origin` remain possible for explicit CLI/service jobs. This is intentional: browser requests provide `Origin`, while maintenance tools such as the importer can authenticate without pretending to be a browser.

CORS never uses a wildcard with credentials.

## Login throttling

`004_auth_hardening.sql` adds `auth_login_attempts`.

Failed password login is limited over a 15-minute window:

- 8 failures per normalized email key;
- 30 failures per client-IP key.

The table stores salted SHA-256 pseudonymous keys, not raw email/IP strings. Production requires `AUTH_RATE_LIMIT_SALT` as a Worker secret. Development uses a fixed development-only salt so local tests do not require secret setup.

Old attempt rows are pruned opportunistically after login activity.

## Production administrator bootstrap

`BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` are accepted **only when `ENVIRONMENT` is not `production`**. They exist for local development compatibility.

Production creates the first administrator out-of-band, after migrations:

```powershell
$env:DATABASE_URL="postgres://USER:PASSWORD@HOST:5432/adoforum?sslmode=require"
$env:ELF_ADMIN_PASSWORD="use-a-long-unique-password"
npm run auth:create-admin -- --email admin@example.com --name "ELF Admin"
Remove-Item Env:ELF_ADMIN_PASSWORD
```

The script refuses to silently promote/reactivate an existing non-admin account, and it never accepts the password as a command-line argument.

## Admin frontend

The API always enforces roles even if `admin.example.com` is additionally protected by Cloudflare Access. Access is defense-in-depth, not authorization state.

## Security-related API operations

- `POST /api/auth/change-password`
- `POST /api/auth/logout-all`
- `PATCH /api/admin/users/:id/status`
- `POST /api/admin/users/:id/reset-password`

User creation, status changes, role changes, password changes/resets, and authentication events are audited.

## Remaining work

- dedicated service identity / execution path for scheduled TUF imports (planned with the Cron Trigger work);
- password-recovery or external identity-provider flow if self-service recovery is needed;
- bot mitigation if public self-registration is ever added;
- moderation policy for free-text proposal/comments.
