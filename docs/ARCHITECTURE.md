# Architecture

## Trust boundaries

```text
Public browser                     Staff browser
      |                                 |
      v                                 v
enhanced-level-forum-web Worker       enhanced-level-forum-admin Worker
      |                                 |
      +-------------- HTTPS ------------+
                     |
                     v
               enhanced-level-forum-api Worker
                     |
                 Hyperdrive
                     |
                     v
                 PostgreSQL
```

The public and staff frontends never receive database credentials. All mutations pass through the API and its role checks.

## Canonical vs evidence

The main design distinction is not “official vs unofficial user”. It is **decision vs evidence**.

Canonical decision:

```text
canonical_ratings
  family = G
  tier   = 9
```

Human evidence:

```text
rating_votes
  family      = G
  anchor_tier = 9
  lean        = +1  # slightly toward G10
  confidence  = 4/5
```

External evidence:

```text
import_snapshots
external_level_observations
external_rating_observations
external_reference_observations
import_issues
```

Machine evidence:

```text
analyzer_runs / analyzer_predictions
```

Only a staff rerate workflow writes `canonical_ratings`.

## External import boundary

External services are observations, not alternate writers of ELF truth.

A TUF import does this:

1. fetches the public TUF v2 level pages and Reference list, or accepts the same shape as a test fixture;
2. stores the complete source payload in `import_snapshots`;
3. derives normalized external level/rating/reference observation rows;
4. preserves non-PGU/special labels without coercing them into ELF P/G/U;
5. records malformed, duplicated, or conflicting source data in `import_issues`;
6. links an observation to an ELF Level only through an existing external-ID mapping or an exact SHA-256 LevelVersion match.

It explicitly does **not** create an ELF Level, publish a canonical rating, or create/move an ELF Reference. The importer module is statically checked to keep `canonical_ratings` and `difficulty_references` outside its dependency surface.

`external_level_ids` is the persistent source-ID mapping table. An exact SHA-256 match may safely establish this mapping; a disagreement between an existing source-ID mapping and a SHA match is recorded as an import error instead of silently remapping the source ID.

## References

Reference membership is a separate entity from the chart rating.

A rerate does this:

1. closes the previous current canonical rating;
2. inserts the new integer canonical tier;
3. finds ACTIVE references attached to the same LevelVersion;
4. if a Reference slot no longer matches family/tier, marks it `NEEDS_REVIEW`;
5. records reference history and audit entries.

This intentionally reverses the “Reference cannot be rerated” dependency.

## Roles

- `VIEWER`: authenticated community member; proposals/votes on proposals.
- `RATER`: plus difficulty evidence votes.
- `REFERENCE_MANAGER`: plus Reference/import management.
- `MODERATOR`: plus canonical rerates, proposal decisions and audit access.
- `ADMIN`: plus user creation/role management.

## Future integration points

The external observation layer is now usable for TUF snapshots. Natural next additions are:

- a human linking/reconciliation UI for unmatched external level IDs;
- TUF snapshot diffs and changed-rating alerts;
- Clastar Galaxy normalization into the same external observation layer;
- Reference redundancy/coverage lint;
- Analyzer service authentication and prediction ingestion.
