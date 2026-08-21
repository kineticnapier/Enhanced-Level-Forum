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

For high K, the default model still uses abstract left/right input resources. 32K is labeled `L16..L1 / R1..R16`; 36K is `L18..L1 / R1..R18`. These labels do not imply 32 or 36 physical human fingers; they are fallback input-resource approximations when the actual keyboard layout is unknown.

The DP records both average cost and rolling local peak load (`peakLocalCostPerPress`). A low-K solution is not considered sufficient merely because the whole-chart average is acceptable if a larger-K lookahead removes a strong local bottleneck.

Moderate two-key alternation prefers `LI ↔ RI`, while 3K uses `LI / RI / RM` to represent triplet-like rolls.

### Lanes and physical fingers

`fingering-dp-v0.8` can model lane/key count separately from the physical fingers that operate those lanes.

```text
Lane / key
   ↓ mapped to
Physical finger
```

When a real layout is known, JSON input may provide `laneFingerMap` and optionally `laneLabels`. Multiple lanes may map to the same physical finger.

```json
{
  "keyCounts": [16],
  "traceKeyCount": 16,
  "laneLabels": [
    "K01", "K02", "K03", "K04", "K05", "K06", "K07", "K08",
    "K09", "K10", "K11", "K12", "K13", "K14", "K15", "K16"
  ],
  "laneFingerMap": [
    "LP", "LR", "LM", "LI", "LP", "LP", "LT", "LT",
    "RI", "RM", "RR", "RP", "RT", "RT", "RP", "RP"
  ],
  "hitTimesMs": [0, 60, 120, 180]
}
```

This example has 16 lanes but only 10 physical fingers. Internally the DP then:

- tracks `lastUse` and reuse penalties per physical finger rather than per lane
- adds only a small `laneSwitchWeight` / `laneJumpWeight` cost when one physical finger changes lane
- prevents a single physical finger from satisfying two presses in the same chord
- does not treat more lanes as automatically increasing physical simultaneous-input capacity
- does not add a general hand-reposition penalty; the intended model keeps the hand mostly fixed and changes participating fingers/lanes

For example, an 11-press chord on the 16-lane/10-finger mapping above is rejected with `SIMULTANEOUS_PRESS_COUNT_EXCEEDS_PHYSICAL_FINGERS` instead of being accepted merely because 16 lanes exist.

Output includes `laneProfile`, `physicalFingerProfile`, `physicalFingerCount`, `laneCounts`, `fingerCounts`, and `laneSwitchRate`. `fingerProfile` is currently retained as the lane-viewer profile for replay compatibility. Trace entries contain both `lane` / `laneLabel` and `physicalFinger` / `physicalFingerLabel`.

Results that use a real lane-to-finger map include the informational `CUSTOM_LANE_FINGER_MAP` warning; it is not an error.

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
- `CUSTOM_LANE_FINGER_MAP`: analysis used an explicit lane-to-physical-finger mapping
- `BEAM_PRUNED`

`EXTREME_KEY_COUNT` does not mean "humanly impossible". It means the current automatic search range/model did not find a sufficiently practical solution.

Analyzer output remains Version-specific evidence and never modifies `canonical_ratings`.
