# API v0.3

[日本語](../API.md) | **English**

Base URL in development: `http://localhost:8787/api`.

Browser calls use credentialed fetch. Development sessions use the HttpOnly `elf_session` cookie; production uses host-only `__Host-elf_session`.

For browser state-changing requests, `Origin` must exactly match `WEB_ORIGIN` or `ADMIN_ORIGIN`.

## Public/auth

- `GET /health`
- `GET /config`
- `GET /stats`
- `GET /auth/me`
- `POST /auth/login`
- `POST /auth/logout`
- `POST /auth/logout-all` — authenticated
- `POST /auth/change-password` — authenticated

Password change body:

```json
{
  "currentPassword": "current passphrase",
  "newPassword": "new passphrase with 12+ chars"
}
```

Changing the password revokes every other session for that user.

Password logins are throttled over a 15-minute window. Production requires the `AUTH_RATE_LIMIT_SALT` Worker secret.

## Levels

- `GET /levels?search=&family=&limit=&offset=`
- `GET /levels/:id`
- `POST /levels/:id/votes` — RATER+

Rating evidence body:

```json
{
  "family": "G",
  "anchorTier": 9,
  "lean": 1,
  "confidence": 4,
  "comment": "G9 referencesより少し上だがG10までは感じない"
}
```

`lean` is one of `-2,-1,0,1,2`. It is evidence only.

## References

- `GET /references?family=&tier=&status=`
- `GET /references/coverage`

## Proposals

Compatibility routes:

- `GET /proposals?status=`
- `POST /proposals` — authenticated
- `POST /proposals/:id/votes` — authenticated

The richer public governance routes live under `/governance/*`.

## Staff/admin

- `GET /admin/overview` — REFERENCE_MANAGER+
- `POST /admin/levels` — MODERATOR+
- `PATCH /admin/levels/:id` — MODERATOR+
- `POST /admin/levels/:id/versions` — MODERATOR+
- `POST /admin/levels/:id/ratings` — MODERATOR+
- `POST /admin/references` — REFERENCE_MANAGER+
- `PATCH /admin/references/:id` — REFERENCE_MANAGER+
- `PATCH /admin/proposals/:id/decision` — MODERATOR+
- `GET /admin/users` — ADMIN
- `POST /admin/users` — ADMIN
- `PATCH /admin/users/:id/role` — ADMIN
- `PATCH /admin/users/:id/status` — ADMIN
- `POST /admin/users/:id/reset-password` — ADMIN
- `GET /admin/import-snapshots` — REFERENCE_MANAGER+
- `POST /admin/import-snapshots` — REFERENCE_MANAGER+
- `POST /admin/imports/tuf` — REFERENCE_MANAGER+
- `GET /admin/imports/tuf/summary?snapshotId=<uuid>` — REFERENCE_MANAGER+
- `GET /admin/imports/tuf/issues?snapshotId=<uuid>` — REFERENCE_MANAGER+
- `GET /admin/audit` — MODERATOR+

### User administration

`POST /admin/users` requires a password between 12 and 256 characters. Accounts are active by default.

Disable/reactivate:

```json
{ "isActive": false }
```

sent to `PATCH /admin/users/:id/status`.

Reset password:

```json
{ "password": "new long passphrase" }
```

sent to `POST /admin/users/:id/reset-password`. A reset revokes all sessions for the target user. Role changes also revoke sessions. The final active ADMIN cannot be disabled or demoted.

## TUF import

`POST /admin/imports/tuf` without a request body fetches the current public TUF v2 level search and Reference endpoints, stores one raw snapshot, and derives external-only observations.

For deterministic tests/offline imports, the same endpoint accepts:

```json
{
  "sourceVersion": "fixture:test",
  "rawData": {
    "levels": [],
    "references": []
  }
}
```

The importer may create an `external_level_ids` mapping when an incoming valid SHA-256 exactly matches an existing ELF `LevelVersion`. It does **not** create ELF Levels and does **not** write `canonical_ratings` or `difficulty_references`.

TUF PGU labels such as `G9` are stored as external rating observations. Non-PGU/special labels are preserved in `label`/`difficulty_label` with no forced ELF PGU conversion.

Import diagnostics are stored in `import_issues`; examples include duplicate TUF IDs, conflicting ratings for the same SHA, malformed Reference rows, and external-ID/SHA mapping conflicts.

Canonical rerate body:

```json
{
  "levelVersionId": "uuid",
  "family": "G",
  "tier": 10,
  "confidence": 0.78,
  "reason": "Accepted rerate proposal #..."
}
```

There is no canonical decimal `value` field in v0.3.
