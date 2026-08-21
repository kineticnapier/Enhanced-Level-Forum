# Analyzer

[日本語](../ANALYZER.md)

ELF Analyzer does not automatically decide canonical difficulty. It generates machine-derived evidence for a specific Version to assist human rating.

> Analyzer output must never directly create or modify a canonical rating.

## One-command workflow

The normal path only needs one `.adofai` file:

```powershell
npm run analyzer:fingering -- .\WYSI.adofai
```

It automatically creates `WYSI-result.json` and `WYSI-replay.html` next to the chart. Replay textures are auto-detected from `ELF_ADOFAI_ASSETS`, nearby/current `Texture2D/` directories, or `scripts/analyzer/replay-assets/`; missing assets fall back to vector rendering. Overrides remain available through `--assets`, `--output-dir`, `--html`, `--stdout`, and `--no-view`.

## Fingering DP

The default adaptive key-count curve is:

```text
2K → 3K → 4K → 6K → 8K → 10K → 12K → 16K → 24K → 32K → 36K
```

Other counts such as 5K/7K remain available when explicitly requested, and the internal API accepts up to 64K.

For high K, the default model uses abstract left/right input resources. 32K is internally labeled `L16..L1 / R1..R16`; 36K is `L18..L1 / R1..R18`. These labels do not imply 32 or 36 physical human fingers; they are fallback input-resource approximations when the actual layout is unknown.

The DP records both average cost and rolling local peak load (`peakLocalCostPerPress`). A low-K solution is not considered sufficient merely because the whole-chart average is acceptable if a larger-K lookahead removes a strong local bottleneck. Moderate two-key alternation prefers `LI ↔ RI`, while 3K uses `LI / RI / RM` to represent triplet-like rolls.

### Lanes and physical fingers

`fingering-dp-v0.10` models lane/key count separately from physical fingers/resources.

```text
Lane / key
   ↓ mapped to
Physical finger / resource
```

When a real layout is known, JSON input may provide `laneFingerMap` and optionally `laneLabels`. Multiple lanes may map to the same physical finger. Reuse state is tracked per physical finger, while changing lane with the same finger only adds the small `laneSwitchWeight` / `laneJumpWeight` cost. The model does not add a general hand-reposition penalty.

### Same-finger simultaneous lanes

Physical finger count is not a universal simultaneous-input hard cap. Real layouts where one finger can depress multiple keys at once can declare `simultaneousLaneGroups`.

```json
{
  "simultaneousLaneGroups": [
    ["K05", "K06"],
    ["K13", "K14"]
  ]
}
```

Every group must contain lanes mapped to one physical finger. Any subset of a declared group is considered simultaneously usable, and those presses are not charged as zero-ms sequential reuse. The layout exposes `simultaneousCapacity`; chords above it fail with `SIMULTANEOUS_PRESS_COUNT_EXCEEDS_LAYOUT_CAPACITY`.

### Cross-hand chords and foot input

v0.10 adds explicit costs for input patterns that are harder to execute accurately:

- **Cross-hand simultaneous chord**: when one same-time chord spans both left and right hands, `crossHandChordWeight` is added once. The default is `0.45`. Ordinary time-separated alternation such as `LI → RI → LI → RI` does not receive this chord penalty.
- **Foot input**: in the generic high-K model, the first eight resources on each side are treated as hand inputs and later resources are treated as foot inputs. These correspond to `K17`, `K18`, ... in the JRP-style viewer. Every foot press adds `footUseWeight`, default `0.85`. Foot input is discouraged rather than forbidden, so the DP may still use it under sufficiently high density.

Custom layouts can explicitly mark foot resources:

```json
{
  "laneFingerMap": [
    { "lane": "K01", "finger": "LI" },
    { "lane": "K17", "finger": "F1", "resourceKind": "FOOT" }
  ]
}
```

`"foot": true` is also accepted as an alias for `resourceKind: "FOOT"`. Foot resources are excluded from normal hand ergonomics and from cross-hand chord detection; they are evaluated through the separate foot-use cost.

Output includes `crossHandChordCount`, `footLaneCount`, `footPresses`, `footUseRate`, `maxCrossHandChordPenalty`, and `maxFootPenalty`. Trace entries include `resourceKind` (`HAND` or `FOOT`).

## Replay Viewer

The replay synchronizes chart geometry, planet motion, Twirl, SetSpeed, and estimated input assignment on one playback clock. Generic high-K viewing uses a JRP-style layout:

```text
L4 L3 L2 L1 | R1 R2 R3 R4
L8 L7 L6 L5 | R5 R6 R7 R8
K17 K18 K19 ...
```

The internal abstract high-K resource names are remapped to priority-oriented `L1..L8 / R1..R8` display labels, so an internal first left resource such as `L18` is presented as `L1`. Explicit/custom lane layouts keep their actual lane labels instead of being renamed.

Each key displays its cumulative press count. The footer displays rolling one-second `KPS` and cumulative `Total` presses at the current replay time. KPS is calculated in chart time, independent of playback speed. Keys beyond 16 are placed below the two primary rows and wrap as needed.

Optional locally exported game textures include `tile_unlit.png`, `planet-red.png`, `planet-blue.png`, `swirl_red.png`, `swirl_blue.png`, `SetSpeed.png`, `SpeedDown.png`, and `tile_samespeed.png`. Game assets themselves are not committed to ELF; they are embedded locally into the generated standalone HTML.

## Timing extractor

The current `.adofai` timing extractor handles `angleData`, legacy `pathData`, `Twirl`, `SetSpeed`, BPM/pitch, midspin, Pause, and Hold timeline length.

Current explicit approximations include:

- `HOLD_INPUT_SEMANTICS_APPROXIMATE`
- `MULTIPLANET_PRESS_COUNT_NOT_MODELED`
- `AUTOPLAY_TILE_INPUT_NOT_MODELED`

## Analyzer warnings

- `STANDARD_FINGERING_MODEL_OUT_OF_RANGE`: the practical threshold is not met inside the ordinary <=10K model range
- `MULTI_KEYBOARD_LIKELY`: the practical key count is above 10K
- `EXTREME_KEY_COUNT`: the automatic search reaches 36K without meeting the practical threshold
- `HIGH_SIMULTANEOUS_PRESS_COUNT`
- `CUSTOM_LANE_FINGER_MAP`: analysis used an explicit lane-to-physical-finger mapping
- `CUSTOM_SIMULTANEOUS_LANE_GROUPS`: analysis used explicit same-finger simultaneous lane groups
- `FOOT_INPUT_USED`: the selected trace used foot resources
- `BEAM_PRUNED`

`EXTREME_KEY_COUNT` does not mean "humanly impossible". It means the current automatic search range/model did not find a sufficiently practical solution.

Analyzer output remains Version-specific evidence and never modifies `canonical_ratings`.
