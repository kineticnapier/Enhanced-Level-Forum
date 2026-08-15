# Security notes

## Authentication

- passwords are stored as PBKDF2-SHA256 hashes with a random salt;
- session cookies are HttpOnly and SameSite=Lax;
- production cookies are Secure;
- the database stores only SHA-256 hashes of session tokens;
- sessions expire after 14 days.

For production, set `COOKIE_DOMAIN` to the shared parent domain (for example `.example.com`) when the public/admin frontends and API are on sibling subdomains.

## CORS

The API reflects an Origin only when it exactly matches `WEB_ORIGIN` or `ADMIN_ORIGIN`. Do not configure a wildcard for credentialed endpoints.

## Admin frontend

The API always enforces roles even if the admin frontend is additionally protected by Cloudflare Access. Access is defense-in-depth, not authorization state.

## Bootstrap admin

`BOOTSTRAP_ADMIN_PASSWORD` is a deployment secret. It is only accepted for `BOOTSTRAP_ADMIN_EMAIL` if no database user exists with that email. Rotate/remove it after bootstrap.

## Remaining work before a large public launch

- CSRF token/double-submit protection for state-changing endpoints if deployment stops being same-site;
- login/rating/proposal rate limits;
- password reset / identity-provider flow;
- bot mitigation for public account creation if self-registration is added;
- content moderation policy for free-text comments;
- dedicated service credentials for Analyzer/import jobs.
