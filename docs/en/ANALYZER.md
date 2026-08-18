# Analyzer

[日本語](../ANALYZER.md)

ELF Analyzer does not automatically decide canonical difficulty. It generates machine-derived evidence for a specific Version to assist human rating.

> Analyzer output must never directly create or modify a canonical rating.

## v0.1: DP fingering estimation

The first Analyzer estimates fingering under several key-count assumptions from an input timing sequence.

```text
input timings
↓
beam-pruned dynamic programming
↓
2K / 4K / 6K / 8K / 10K / 12K / 16K / 24K ...
↓
minimum estimated cost for each key count
↓
key-count curve + warnings
```

Very large charts are intentionally analyzed locally in v0.1 rather than inside a Cloudflare Worker, where a large DP workload could hit CPU limits.

## Input

v0.1 accepts already extracted input timings rather than parsing an `.adofai` file directly.

Single-press stream:

```json
{
  "levelVersionId": "optional-version-id",
  "sha256": "optional-sha256",
  "hitTimesMs": [0, 100, 200, 300],
  "keyCounts": [2, 4, 6, 8, 10, 12, 16, 24]
}
```

Explicit simultaneous presses:

```json
{
  "events": [
    { "timeMs": 0, "presses": 1 },
    { "timeMs": 100, "presses": 3 },
    { "timeMs": 200, "presses": 1 }
  ]
}
```

Repeated identical values in `hitTimesMs` are grouped as simultaneous presses.

## Run

```powershell
npm run analyzer:fingering -- .\timings.json
```

Write the result to a file:

```powershell
npm run analyzer:fingering -- .\timings.json .\result.json
```

## DP state

v0.1 primarily tracks:

- last-use time for every finger/key
- previous finger
- use count per finger
- minimum reuse interval per finger
- same-finger transition count
- switch count
- maximum reuse penalty

Each input expands candidate finger assignments and keeps only the lowest-cost states in a beam. It is therefore deterministic approximate DP rather than exhaustive search.

## Cost

The current cost function is provisional. It includes:

- a penalty for reusing one finger after a short interval
- movement distance between finger positions
- a small extra same-finger transition penalty

The coefficients are intended to be calibrated later using real rater fingering data.

## Key-count curve

The same timing sequence is analyzed for multiple key counts.

```text
2K   cost = ...
4K   cost = ...
6K   cost = ...
8K   cost = ...
10K  cost = ...
12K  cost = ...
16K  cost = ...
24K  cost = ...
```

The output contains:

- `estimatedMinKeys`: first key count that satisfies the practical threshold
- `comfortableKeys`: first key count satisfying the lower comfortable threshold
- `keyCountCurve`: cost and fingering statistics for every tested key count

These are not difficulty ratings. A chart estimated to require 12K does not automatically map to any specific U-family tier.

## Warnings

v0.1 can emit:

- `STANDARD_FINGERING_MODEL_OUT_OF_RANGE`: no tested key count up to 10K satisfies the practical threshold
- `MULTI_KEYBOARD_LIKELY`: the practical threshold first requires at least 11K
- `EXTREME_KEY_COUNT`: even the largest tested key count misses the practical threshold
- `HIGH_SIMULTANEOUS_PRESS_COUNT`: a timing contains more than 10 simultaneous presses
- `BEAM_PRUNED`: candidates were removed by the beam-width limit

## Analyzer and Rating

Analyzer output is Version-specific evidence.

```text
Level
└─ Variant
   └─ Version
      ├─ Human rating evidence
      ├─ References
      ├─ External evidence
      └─ Analyzer evidence
```

The Analyzer does not modify `canonical_ratings`. Future persistence through `analyzer_runs` / `analyzer_predictions` must preserve that rule.

## Next steps

After v0.1:

1. accurately extract input timings from `.adofai`
2. interpret SetSpeed / Twirl / Midspin / MultiPlanet and related events
3. add local burst / stamina / percentile features
4. calibrate costs from real fingering data
5. persist Analyzer results and expose them in Admin
6. add a P/G/U family classifier and tier regressor

Even after a difficulty model exists, the final canonical rating remains human-controlled.
