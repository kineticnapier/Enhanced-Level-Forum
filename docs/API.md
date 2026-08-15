# API v0.3

Base URL in development: `http://localhost:8787/api`.

All browser writes use the HttpOnly `elf_session` cookie and `credentials: include`.

## Public/auth

- `GET /health`
- `GET /config`
- `GET /stats`
- `GET /auth/me`
- `POST /auth/login`
- `POST /auth/logout`

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

- `GET /proposals?status=`
- `POST /proposals` — authenticated
- `POST /proposals/:id/votes` — authenticated

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
- `GET /admin/import-snapshots` — REFERENCE_MANAGER+
- `POST /admin/import-snapshots` — REFERENCE_MANAGER+
- `GET /admin/audit` — MODERATOR+

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
