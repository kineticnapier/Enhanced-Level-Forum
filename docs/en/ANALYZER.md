# Analyzer

[日本語](../ANALYZER.md)

ELF Analyzer does not automatically decide canonical difficulty. It generates machine-derived evidence for a specific Version to assist human rating.

> Analyzer output must never directly create or modify a canonical rating.

## One-command workflow

The normal path only needs one `.adofai` file:

```powershell
npm run analyzer:fingering -- .\WYSI.adofai
```

It automatically creates next to the chart:

```text
WYSI-result.json
WYSI-replay.html
```

The command runs `.adofai` timing extraction, fingering DP, JSON output, and replay generation in sequence.

Replay Texture2D assets are auto-detected from `--assets`, `ELF_ADOFAI_ASSETS`, sibling/current `Texture2D/` directories, the chart/current directory, and finally `scripts/analyzer/replay-assets/`. Missing textures fall back individually to vector rendering.

Optional overrides include `--output-dir`, `--html`, `--stdout`, and `--no-view`.

## Fingering model

The standard adaptive key-count curve is:

```text
2K → 3K → 4K → 6K → 8K → 10K → 12K → 16K → 24K → 32K
```

5K and 7K remain available when explicitly requested but are not automatic bridge points. Automatic human-fingering search runs through 32K; direct `estimateFingeringForKeyCount` calls still accept up to 64K.

- natural two-key alternation prefers `LI ↔ RI`
- 3K uses `LI / RI / RM` to represent triplet-like rolls
- local load is tracked with `peakLocalCostPerPress`, not only whole-chart average cost
- larger-K lookahead prevents a short 6K-sensitive burst from being hidden by an otherwise easy 4K average

`STANDARD_FINGERING_MODEL_OUT_OF_RANGE` means the chart does not fit the practical threshold within the ordinary <=10K range. `EXTREME_KEY_COUNT` is reserved for cases where the automatic search still cannot find a practical fingering by 32K.

## .adofai timing extractor

The extractor currently handles:

- `angleData`
- legacy `pathData`
- `Twirl`
- `SetSpeed` (`Multiplier` / absolute BPM)
- `settings.bpm`
- `settings.pitch`
- midspin (`999` / `!`)
- `Pause` duration
- `Hold` duration as timeline length

Trailing commas commonly found in `.adofai` JSON are accepted.

`settings.offset` and `countdownTicks` are preserved as playback metadata but are not added to relative fingering intervals.

### Current approximations

- `HOLD_INPUT_SEMANTICS_APPROXIMATE`
- `MULTIPLANET_PRESS_COUNT_NOT_MODELED`
- `AUTOPLAY_TILE_INPUT_NOT_MODELED`

Results with these warnings should not be treated as having the same timing fidelity as ordinary charts.

## Replay

The generated standalone HTML renders:

- chart geometry
- planet position
- Twirl / SetSpeed markers
- floor / BPM / direction
- DP finger key viewer
- play / pause / seek / speed / zoom

When available, locally exported AssetStudio/AssetRipper Texture2D files are embedded:

```text
tile_unlit.png
planet-red.png
planet-blue.png
swirl_red.png
swirl_blue.png
SetSpeed.png
SpeedDown.png
tile_samespeed.png
```

Game assets themselves are not committed to the ELF repository.

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

The Analyzer never modifies `canonical_ratings`. Future persistence through `analyzer_runs` / `analyzer_predictions` must preserve that rule.
