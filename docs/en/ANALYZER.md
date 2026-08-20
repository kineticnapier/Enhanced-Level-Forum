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

Replay textures are auto-detected from `ELF_ADOFAI_ASSETS`, nearby/current `Texture2D/` directories, or `scripts/analyzer/replay-assets/`. Missing assets fall back to vector rendering. Overrides remain available through `--assets`, `--output-dir`, `--html`, `--stdout`, and `--no-view`.

## Fingering DP

The default adaptive key-count curve is:

```text
2K → 3K → 4K → 6K → 8K → 10K → 12K → 16K → 24K → 32K → 36K
```

Other counts such as 5K/7K remain available when explicitly requested, and the internal API accepts up to 64K.

For high K, the model uses abstract left/right input resources. 32K is labeled `L16..L1 / R1..R16`; 36K is `L18..L1 / R1..R18`. These labels do not imply 32 or 36 physical human fingers: they approximate keyboard, multiple-device, foot, or other input resources.

The DP records both average cost and rolling local peak load (`peakLocalCostPerPress`). A low-K solution is not considered sufficient merely because the whole-chart average is acceptable if a larger-K lookahead removes a strong local bottleneck.

Moderate two-key alternation prefers `LI ↔ RI`, while 3K uses `LI / RI / RM` to represent triplet-like rolls.

## Replay Viewer

The replay synchronizes chart geometry, planet motion, Twirl, SetSpeed, and estimated input assignment on one playback clock.

For high K, the key viewer is split into left and right blocks. 32K/36K automatically use compact keys; narrower displays wrap each side into multiple rows instead of clipping beyond the viewport.

Optional locally exported game textures:

- `tile_unlit.png`
- `planet-red.png`
- `planet-blue.png`
- `swirl_red.png`
- `swirl_blue.png`
- `SetSpeed.png`
- `SpeedDown.png`
- `tile_samespeed.png`

Game assets themselves are not committed to ELF; they are embedded locally into the generated standalone HTML.

## Timing extractor

The current `.adofai` timing extractor handles the main timing primitives used by the analyzer, including `angleData`, legacy `pathData`, `Twirl`, `SetSpeed`, BPM/pitch, midspin, Pause, and Hold timeline length.

Current explicit approximations include:

- `HOLD_INPUT_SEMANTICS_APPROXIMATE`
- `MULTIPLANET_PRESS_COUNT_NOT_MODELED`
- `AUTOPLAY_TILE_INPUT_NOT_MODELED`

## Analyzer warnings

- `STANDARD_FINGERING_MODEL_OUT_OF_RANGE`: the practical threshold is not met inside the ordinary <=10K model range
- `MULTI_KEYBOARD_LIKELY`: the practical key count is above 10K
- `EXTREME_KEY_COUNT`: the automatic search reaches 36K without meeting the practical threshold
- `HIGH_SIMULTANEOUS_PRESS_COUNT`
- `BEAM_PRUNED`

`EXTREME_KEY_COUNT` does not mean "humanly impossible". It means the current automatic search range/model did not find a sufficiently practical solution.

Analyzer output remains Version-specific evidence and never modifies `canonical_ratings`.
