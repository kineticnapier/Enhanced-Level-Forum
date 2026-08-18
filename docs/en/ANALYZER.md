# Analyzer

[日本語](../ANALYZER.md)

ELF Analyzer does not automatically decide canonical difficulty. It generates machine-derived evidence for a specific Version to assist human rating.

> Analyzer output must never directly create or modify a canonical rating.

## v0.2: .adofai → timing → DP fingering

The Analyzer can now read an `.adofai` file directly, reconstruct its press timing sequence, then estimate fingering under several key-count assumptions.

```text
.adofai
↓
angleData / pathData
↓
Twirl / SetSpeed / pitch / midspin
↓
press timings
↓
beam-pruned dynamic programming
↓
2K / 4K / 6K / 8K / 10K / 12K / 16K / 24K ...
↓
key-count curve + warnings
```

Large charts are still analyzed locally rather than inside a Cloudflare Worker because DP search can become expensive.

## Run

Analyze an `.adofai` file directly:

```powershell
npm run analyzer:fingering -- .\level.adofai
```

Write JSON output:

```powershell
npm run analyzer:fingering -- .\level.adofai .\result.json
```

The previous extracted-timing JSON format remains supported:

```powershell
npm run analyzer:fingering -- .\timings.json
```

## .adofai timing extractor

`adofai-timing-v0.2` currently handles:

- `angleData`
- legacy `pathData`
- `Twirl`
- `SetSpeed`
  - `Multiplier`
  - absolute BPM through `beatsPerMinute`
- `settings.bpm`
- `settings.pitch`
- midspin (`999` / `!`)
- `Pause` duration
- `Hold` duration as timeline length

It also accepts the trailing commas commonly found in `.adofai` JSON.

`settings.offset` and `countdownTicks` are preserved as playback metadata but are not added to relative fingering intervals.

### Current approximations

`Hold` extends the timing sequence, but the DP does not yet model a finger remaining occupied while the hold is active. Such charts emit:

- `HOLD_INPUT_SEMANTICS_APPROXIMATE`

`MultiPlanet` press multiplicity is not reconstructed yet, so it emits:

- `MULTIPLANET_PRESS_COUNT_NOT_MODELED`

`AutoPlayTiles` is not yet removed from player-input events, so it emits:

- `AUTOPLAY_TILE_INPUT_NOT_MODELED`

Results with these warnings should not be treated as having the same timing fidelity as ordinary charts.

## Timing output

For direct `.adofai` input, Analyzer JSON contains a `timing` section with fields such as:

- `extractorVersion`
- `angleSource`: `angleData` / `pathData`
- `pathEntryCount`
- `pressEventCount`
- `baseBpm`
- `pitch`
- `offsetMs`
- `warnings`
- `unsupportedEvents`
- `segments`

`segments` stores per-segment BPM, travel angle, beat length, and reconstructed hit time for debugging timing reconstruction.

## Direct timing input

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

## DP state

The current model primarily tracks:

- last-use time for every finger/key
- previous finger
- use count per finger
- minimum reuse interval per finger
- same-finger transition count
- switch count
- maximum reuse penalty

Each input expands candidate finger assignments and keeps only the lowest-cost states in a beam. It is deterministic approximate DP rather than exhaustive search.

## Cost

The current cost function is provisional. It includes:

- a penalty for reusing one finger after a short interval
- movement distance between finger positions
- a small extra same-finger transition penalty

The coefficients can later be calibrated using real rater fingering data.

## Key-count curve

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

- `estimatedMinKeys`: first key count satisfying the practical threshold
- `comfortableKeys`: first key count satisfying the lower comfortable threshold
- `keyCountCurve`: cost and fingering statistics for every tested key count

These values are not difficulty ratings.

## Analyzer warnings

The fingering DP can emit:

- `STANDARD_FINGERING_MODEL_OUT_OF_RANGE`
- `MULTI_KEYBOARD_LIKELY`
- `EXTREME_KEY_COUNT`
- `HIGH_SIMULTANEOUS_PRESS_COUNT`
- `BEAM_PRUNED`

Timing-extractor warnings are preserved separately.

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

1. add more timing comparisons against real charts
2. model finger occupancy for `Hold`
3. reconstruct `MultiPlanet` input sequences
4. add local burst / stamina / percentile features
5. calibrate costs from real fingering data
6. persist Analyzer results and expose them in Admin
7. add a P/G/U family classifier and tier regressor

Even after a difficulty model exists, the final canonical rating remains human-controlled.
