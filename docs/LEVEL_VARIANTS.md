# Level / Variant / Version

[English](en/LEVEL_VARIANTS.md)

ELF separates a chart work from gameplay variants and file revisions.

```text
Level
└─ Variant
   └─ Version
```

## Level

A **Level** is the work page: the chart family identified by its song and creator/team.

A Level can contain multiple gameplay variants when the same work has intentionally different gameplay conditions or difficulty forms.

Examples:

```text
Hoge - hoge (by hoge)
├─ Original
├─ Nerfed
├─ 10K
└─ No Key Limit
```

A substantial remake that is reasonably treated as a separate work should normally be a new Level rather than another Variant.

## Variant

A **Variant** is a gameplay form of a Level.

Typical kinds are:

- `ORIGINAL` — the primary/original gameplay form.
- `NERFED` — intentionally reduced gameplay difficulty.
- `BUFFED` — intentionally increased gameplay difficulty.
- `KEYLIMIT` — gameplay reconstructed for a stated key-count limit.
- `NO_KEY_LIMIT` — a form intentionally not bound by the key limit of another form.
- `CUSTOM` — another explicitly named gameplay variant.

A label alone does not decide the classification. The question is whether the gameplay form itself is intentionally different.

If the exact same chart data is merely played under a different external condition, it does not automatically require another Variant. A separate Variant is appropriate when the chart/gameplay representation itself is a distinct form that ELF should rate and track independently.

Each Variant has its own current Version. One Variant is marked as the Level's primary Variant for compatibility and default display.

## Version

A **Version** is a particular revision of one Variant's chart data.

Typical Version changes include:

- off-sync fixes;
- bug fixes;
- small tile/event corrections;
- VFX or decoration updates;
- optimization;
- compatibility fixes;
- other revisions that remain the same gameplay Variant.

Changing `offset: 728` to `offset: 727`, for example, changes the chart file and therefore may create a new Version even though it remains the same Variant.

SHA-256 identifies the exact file contents associated with a Version. A download URL is only a location from which the file may be obtained; it is not the Version identity because services such as Google Drive can keep the same URL while replacing file contents.

## Rating and clears

Canonical ratings, rating evidence, references, and future clear records attach to **Version**, not directly to Variant or Level.

This permits histories such as:

```text
Level: Hoge - hoge

Original
  v1.0 -> U8
  v1.1 -> U8

Nerfed
  v1.0 -> G19

10K
  v1.0 -> U3
```

Changing a Variant's current Version does not delete or rewrite historical ratings for previous Versions.

## Compatibility

The initial Variant migration preserves all existing Level and Version ids. Every existing Level receives a primary `Original` Variant, and every existing Version is attached to it.

Legacy code that inserts a `level_versions` row using only `level_id` is automatically attached to the Level's primary Variant. This bridge allows the existing submission, TUF reconciliation, and Level management workflows to continue operating while UI/API clients adopt the three-level hierarchy.
