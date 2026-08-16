# v0.2.5 migration fix

[日本語](../MIGRATION_FIX_0.2.4.md) | **English**

## Symptom

`npm run db:migrate` fails near `references` with PostgreSQL error `42601`.

## Cause

`REFERENCES` is part of PostgreSQL SQL grammar. Using the unquoted identifier `references` as a table name makes statements such as `CREATE TABLE references (...)` invalid.

## Fix

The database table was renamed to `difficulty_references`. API URLs and TypeScript response property names are unchanged (`/api/references`, `references`).

`001_initial.sql` is wrapped in `BEGIN` / `COMMIT`, so a failed v0.2.3 application rolls back its schema changes. `schema_migrations` may already exist because the migration runner creates that table before applying migration files; this is harmless. No database recreation is required.

Run:

```powershell
$env:DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/adoforum"
npm run db:migrate
```
