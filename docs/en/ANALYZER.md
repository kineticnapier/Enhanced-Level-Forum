# Analyzer

[日本語](../ANALYZER.md)

ELF Analyzer does not automatically decide the canonical difficulty. It produces machine-generated evidence for a LevelVersion so human raters can inspect it.

> Analyzer output must never directly create or modify a canonical rating.

## One-command analysis

A `.adofai` file can now be processed end-to-end with one command:

```powershell
npm run analyzer:fingering -- .\WYSI.adofai
```

The analyzer automatically creates sibling outputs:

```text
WYSI.adofai
WYSI-result.json
WYSI-replay.html
```

Replay Texture2D assets are auto-detected in this order:

1. `ELF_ADOFAI_ASSETS`
2. `Texture2D/` next to the `.adofai`
3. the `.adofai` directory itself
4. `Texture2D/` under the current working directory
5. the current working directory
6. `scripts/analyzer/replay-assets/`

If no game textures are found, the replay automatically falls back to vector rendering.

Overrides remain available when needed:

```powershell
npm run analyzer:fingering -- .\WYSI.adofai --assets "C:\path\to\Texture2D"
npm run analyzer:fingering -- .\WYSI.adofai --output-dir .\analysis
npm run analyzer:fingering -- .\WYSI.adofai --html .\custom-replay.html
npm run analyzer:fingering -- .\WYSI.adofai --no-view
```

The legacy positional JSON output argument is still supported:

```powershell
npm run analyzer:fingering -- .\WYSI.adofai .\custom-result.json
```

## Pipeline

```text
.adofai
↓
angleData / pathData
↓
Twirl / SetSpeed / pitch / midspin
↓
press timing + track geometry
↓
local-peak-aware hand DP
↓
2K → 3K → 4K → 6K → 8K → 10K → 12K → 16K → 24K
↓
result JSON + replay HTML
```

5K and 7K remain available when explicitly requested, but are not automatic bridge points.

## Fingering model

The current standard profile prefers `LI / RI` for moderate two-key alternation. 3K uses `LI / RI / RM`, allowing fast triplet-like streams to be represented as a genuine three-key roll.

The DP tracks, among other state:

- last use time for each finger
- the previous two fingers
- left/right hand assignment
- same-hand run length
- per-finger usage and minimum reuse gap
- rolling local transition cost

In addition to overall `costPerPress`, each result records `peakLocalCostPerPress`. This helps prevent a chart from being considered comfortable at 4K merely because most of the chart is easy when a short burst becomes substantially easier at 6K.

## ADOFAI timing extraction

The timing extractor currently handles:

- `angleData`
- legacy `pathData`
- `Twirl`
- `SetSpeed`
  - multiplier
  - absolute BPM (`beatsPerMinute`)
- `settings.bpm`
- `settings.pitch`
- midspin (`999` / `!`)
- `Pause` duration
- `Hold` duration as timeline length

Trailing commas in `.adofai` JSON are accepted.

`settings.offset` and `countdownTicks` remain metadata and are not added to relative fingering intervals.

### Current approximations

`Hold` timing is represented but finger occupancy is not yet modeled, so the extractor emits `HOLD_INPUT_SEMANTICS_APPROXIMATE`.

`MultiPlanet` emits `MULTIPLANET_PRESS_COUNT_NOT_MODELED`, and `AutoPlayTiles` emits `AUTOPLAY_TILE_INPUT_NOT_MODELED` while their exact input semantics remain unmodeled.

## Replay

The generated HTML is standalone and includes:

- chart track
- camera following the current floor
- red/blue planets
- Twirl / SetSpeed markers
- BPM / direction / floor HUD
- DP-estimated key viewer
- play, pause, seek, speed and zoom controls

When local game Texture2D exports are available, tile, planet, Twirl and speed-change textures are embedded into the HTML. Game assets themselves are not committed to the ELF repository.

Primary optional files:

- `tile_unlit.png`
- `planet-red.png`
- `planet-blue.png`
- `swirl_red.png`
- `swirl_blue.png`
- `SetSpeed.png`
- `SpeedDown.png`
- `tile_samespeed.png`

## Direct timing JSON input

Pre-extracted timing JSON remains supported. Without an output path, JSON inputs retain the previous stdout behavior.

```json
{
  "hitTimesMs": [0, 100, 200, 300],
  "keyCounts": [2, 3, 4, 6, 8]
}
```

Explicit simultaneous presses can use:

```json
{
  "events": [
    { "timeMs": 0, "presses": 1 },
    { "timeMs": 100, "presses": 3 },
    { "timeMs": 200, "presses": 1 }
  ]
}
```

## Analyzer and Rating

Analyzer results are evidence attached to a Version:

```text
Level
└─ Variant
   └─ Version
      ├─ Human rating evidence
      ├─ References
      ├─ External evidence
      └─ Analyzer evidence
```

The Analyzer never writes `canonical_ratings`. That rule must remain true if results are later persisted through `analyzer_runs` / `analyzer_predictions`.
