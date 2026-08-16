# Scheduled TUF imports

[日本語](../TUF_CRON.md) | **English**

The ELF API Worker incrementally fetches TUF v2 data through a Cloudflare Cron Trigger.

## Schedule

The current cron expression is:

```text
*/30 * * * *
```

Cloudflare Cron Triggers use UTC. This expression runs every 30 minutes, at `:00` and `:30` each hour regardless of timezone.

The same expression is kept in:

- `apps/api/wrangler.jsonc`
- `scripts/production-config.mjs`

## Chunked fetching

A single Cron invocation no longer scans the entire TUF database. Each invocation fetches at most **5 pages = 500 levels** and persists progress in PostgreSQL staging tables.

```text
30-minute Cron
   |
   v
fetch at most 5 pages
   |
   +-- success --> store in tuf_crawl_levels and advance offset
   |
   +-- 502/429/network failure --> stop this run without advancing
   |
   v
finish the crawl over multiple invocations
   |
   +-- fetch References
   |
   v
importTufSnapshot()
   |
   v
publish one complete import_snapshot + external observations
```

The staging tables are:

- `tuf_crawl_state` — crawl ID, next offset, and observed total
- `tuf_crawl_levels` — raw level JSON collected during the crawl

Partial crawl data never becomes an `import_snapshot`, so an upstream failure cannot make a 500-row partial crawl appear as the latest snapshot.

## Consistency guard

Levels are fetched with `RECENT_ASC`. New levels are expected to append, so an increasing total is allowed.

At the start of each Cron invocation, the crawler refetches the previous page and compares its level-ID sequence with the staged boundary. If deletion/reordering shifts the boundary, or if the total decreases, the staged crawl is discarded and the next invocation restarts from offset 0.

A PostgreSQL advisory lock prevents overlapping Cron invocations from advancing the same crawl concurrently.

## When the TUF API is down

The scheduled crawler deliberately does not perform a large retry storm inside one invocation. If a level page or the References endpoint fails, the step returns `DEFERRED` and waits for the next 30-minute tick at the same offset.

For expected upstream failures the Worker calls `controller.noRetry()` instead of requesting an immediate platform retry.

## Data boundary

After a complete crawl, the existing `importTufSnapshot()` importer performs the normal external-observation import.

Scheduled imports may write only:

- `import_snapshots`
- `external_level_observations`
- `external_rating_observations`
- `external_reference_observations`
- `import_issues`
- `external_level_ids` links when exact SHA-256 matching permits them

**They do not modify `canonical_ratings` or `difficulty_references`.**

Cron does not use a human administrator session and runs with `actorId: null`. Completed scheduled snapshots retain the normal `TUF_IMPORT` audit entry and add `TUF_SCHEDULED_IMPORT`.

## Local testing

The incremental crawler adds staging tables, so apply migrations first:

```powershell
npm run setup:local
npm run dev:api
```

From another terminal:

```powershell
curl.exe "http://localhost:8787/cdn-cgi/handler/scheduled?format=json"
```

One invocation normally stages at most 500 rows rather than completing a snapshot. Repeated invocations advance the crawl. This is not a dry-run.

Static validation:

```powershell
npm test
```

## Parallel npm work

Independent work now runs concurrently:

- `npm run build` — shared / API / public / admin in parallel
- `npm run smoke` — static smoke scripts in parallel
- `npm test` — parallel build, then parallel smoke
- `npm run production:deploy` — four builds in parallel, then API / public / admin deploys in parallel

Dependency boundaries such as `build -> smoke` and `build -> deploy` remain sequential.
