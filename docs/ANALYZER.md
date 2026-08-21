# Analyzer

[English](en/ANALYZER.md)

ELF Analyzerは、確定難易度を自動決定する機能ではありません。Versionごとの機械的な解析結果を、人間の査定に使う補助Evidenceとして生成します。

> Analyzer output must never directly create or modify a canonical rating.

## ワンコマンド実行

通常は `.adofai` を1個渡すだけです。

```powershell
npm run analyzer:fingering -- .\WYSI.adofai
```

同じディレクトリに `WYSI-result.json` と `WYSI-replay.html` を生成します。Replay用テクスチャは `ELF_ADOFAI_ASSETS`、譜面横/カレントの `Texture2D/`、`scripts/analyzer/replay-assets/` などから自動検出し、見つからない場合はベクター描画へfallbackします。必要な場合だけ `--assets`, `--output-dir`, `--html`, `--stdout`, `--no-view` を指定できます。

## DP運指推定

標準のadaptive key-count curveは現在:

```text
2K → 3K → 4K → 6K → 8K → 10K → 12K → 16K → 24K → 32K → 36K
```

です。5K/7Kなども明示指定すれば解析でき、内部APIは64Kまで受け付けます。

高Kのデフォルトモデルは左右を均等に分けた抽象キー資源です。32Kは内部的に `L16..L1 / R1..R16`、36Kは `L18..L1 / R1..R18` です。これは32本/36本の物理的な人間の指を意味せず、実際の入力配置が不明な場合の近似です。

現在のDPは平均コストだけでなく、rolling local peak (`peakLocalCostPerPress`) も記録します。4Kで全体平均が低くても、局所burstが6Kで大幅に軽くなる場合は4Kを十分とは判定しにくくします。2キーの通常交互は `LI ↔ RI` を優先し、3Kでは `LI / RI / RM` を使って三連系ロールを表現します。

### Lane と physical finger

`fingering-dp-v0.10` では、キー/lane数と物理的な指を別の状態として扱えます。

```text
Lane / key
   ↓ mapped to
Physical finger / resource
```

実配置が分かる場合はJSON入力へ `laneFingerMap` と、必要なら `laneLabels` を渡します。同じ物理指を複数laneへ割り当てても構いません。DP内部では `lastUse` / 再使用ペナルティをlaneではなく物理指ごとに追跡し、同じ物理指に割り当てられた別laneへ移るときだけ小さい `laneSwitchWeight` / `laneJumpWeight` を加えます。手全体を移動する一般的な「hand reposition cost」は入れません。

### 同一指の同時押し

物理指数は最大同時押し数のhard capではありません。同じ指で複数キーを同時に押せる実配置は `simultaneousLaneGroups` で明示できます。

```json
{
  "simultaneousLaneGroups": [
    ["K05", "K06"],
    ["K13", "K14"]
  ]
}
```

各groupは同じ物理指に割り当てられたlaneだけで構成します。groupの任意の部分集合は同時押し可能として扱い、同一指同時押しを0ms再打鍵としてreuse penaltyへ入れません。配置から `simultaneousCapacity` を計算し、それを超えるchordは `SIMULTANEOUS_PRESS_COUNT_EXCEEDS_LAYOUT_CAPACITY` になります。

### 左右同時押しと足入力

v0.10では、人間の運指で扱いにくい入力を追加コストとしてモデル化します。

- **左右同時押し**: 同一時刻のchordが左手と右手の両方へまたがると `crossHandChordWeight` を1回加算します。既定値は `0.45` です。通常の `LI → RI → LI → RI` のような時間方向の左右交互にはこのchord penaltyを掛けません。
- **足入力**: generic high-Kでは各側の最初の8入力を手、それ以降を足資源として扱います。JRP系KVでは17K以降の `K17`, `K18`, ... に相当します。足1打ごとに `footUseWeight` を加算し、既定値は `0.85` です。足はhard禁止ではなく、高密度で必要ならDPが選べます。

custom layoutではlaneごとに足を明示できます。

```json
{
  "laneFingerMap": [
    { "lane": "K01", "finger": "LI" },
    { "lane": "K17", "finger": "F1", "resourceKind": "FOOT" }
  ]
}
```

`"foot": true` も `resourceKind: "FOOT"` と同じ扱いです。足資源は通常のhand ergonomicsや左右同時押し判定から除外し、足使用ペナルティで別に評価します。

出力には `crossHandChordCount`, `footLaneCount`, `footPresses`, `footUseRate`, `maxCrossHandChordPenalty`, `maxFootPenalty` を含み、trace各打鍵には `resourceKind` (`HAND` / `FOOT`) を持たせます。

## Replay Viewer

Replayはタイミング、譜面形状、惑星位置、Twirl、SetSpeed、推定運指を同じ再生クロックで表示します。generic high-KのKey ViewerはJRP系の配置へ寄せています。

```text
L4 L3 L2 L1 | R1 R2 R3 R4
L8 L7 L6 L5 | R5 R6 R7 R8
K17 K18 K19 ...
```

内部の高K抽象資源名（例: `L18`）はKV上では優先順位ベースの `L1..L8 / R1..R8` へ表示し直します。実 `laneFingerMap` を渡したcustom layoutではこの別名化を行わず、実際のlane labelを維持します。

各キーには現在時刻までの累積打鍵数を表示します。下部には直近1秒のrolling `KPS` と現在時刻までの `Total` 打鍵数を表示します。KPSは再生速度ではなく譜面時間基準です。高Kでは自動的にcompact表示し、17K以降のキーは下側へ折り返します。

本家Texture2Dを書き出している場合は `tile_unlit.png`, `planet-red.png`, `planet-blue.png`, `swirl_red.png`, `swirl_blue.png`, `SetSpeed.png`, `SpeedDown.png`, `tile_samespeed.png` を利用できます。ゲーム素材自体はELF repoへコミットせず、ローカルで読み込んでstandalone HTMLへ埋め込みます。

## .adofai timing extractor

現在のextractorは主に `angleData`, 旧形式 `pathData`, `Twirl`, `SetSpeed` (`Multiplier` / absolute BPM), `settings.bpm`, `settings.pitch`, midspin (`999` / `!`), `Pause`, `Hold` の時間長を処理します。`settings.offset` と `countdownTicks` は再生メタデータとして保持しますが、運指の相対入力間隔には足しません。

### 現在の近似

- `HOLD_INPUT_SEMANTICS_APPROXIMATE`: Hold中の指占有は未モデル化
- `MULTIPLANET_PRESS_COUNT_NOT_MODELED`: MultiPlanetの必要入力数は未復元
- `AUTOPLAY_TILE_INPUT_NOT_MODELED`: AutoPlayTilesの入力除外は未対応

## Analyzer warnings

- `STANDARD_FINGERING_MODEL_OUT_OF_RANGE`: 通常10K以内のモデルではpractical thresholdに収まらない
- `MULTI_KEYBOARD_LIKELY`: practical key countが10Kを超える
- `EXTREME_KEY_COUNT`: 自動探索上限36Kまで試してもpractical thresholdへ到達しない
- `HIGH_SIMULTANEOUS_PRESS_COUNT`
- `CUSTOM_LANE_FINGER_MAP`: 実lane→物理指mappingを使って解析した
- `CUSTOM_SIMULTANEOUS_LANE_GROUPS`: 同一指の同時押しgroupを使って解析した
- `FOOT_INPUT_USED`: 選択されたtraceで足資源を使用した
- `BEAM_PRUNED`

`EXTREME_KEY_COUNT` は「人間には不可能」という意味ではなく、現在の自動探索範囲/モデルでは十分な運指を見つけられなかった、という警告です。

## AnalyzerとRating

Analyzer結果はVersion単位のEvidenceです。Analyzerは`canonical_ratings`を書き換えません。将来`analyzer_runs` / `analyzer_predictions`へ保存する場合も、この原則を維持します。
