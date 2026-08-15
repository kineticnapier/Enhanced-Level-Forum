# Architecture

## Trust boundaries

```text
Public browser                     Staff browser
      |                                 |
      v                                 v
adoforum-web Worker              adoforum-admin Worker
      |                                 |
      +-------------- HTTPS ------------+
                     |
                     v
               adoforum-api Worker
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
import_snapshots / external_rating_observations
```

Machine evidence:

```text
analyzer_runs / analyzer_predictions
```

Only a staff rerate workflow writes `canonical_ratings`.

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

The schema already reserves separate tables for:

- external TUF / Clastar Galaxy observations;
- Analyzer model runs and predictions;
- proposal evidence/history;
- level tags and version hashes.

The next useful backend additions are importer normalization, Reference redundancy lint, Reference coverage scoring and Analyzer service authentication.
