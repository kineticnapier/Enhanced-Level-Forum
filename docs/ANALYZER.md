# Analyzer

[English](en/ANALYZER.md)

ELF Analyzerは、確定難易度を自動決定する機能ではありません。Versionごとの機械的な解析結果を、人間の査定に使う補助Evidenceとして生成します。

> Analyzer output must never directly create or modify a canonical rating.

## ワンコマンド実行

通常は `.adofai` を1個渡すだけです。

```powershell
npm run analyzer:fingering -- .\WYSI.adofai
```

同じディレクトリに自動で:

```text
WYSI-result.json
WYSI-replay.html
```

を生成します。Replay用テクスチャは `ELF_ADOFAI_ASSETS`、譜面横/カレントの `Texture2D/`、`scripts/analyzer/replay-assets/` などから自動検出します。見つからない場合はベクター描画へfallbackします。

必要な場合だけ `--assets`, `--output-dir`, `--html`, `--stdout`, `--no-view` を指定できます。

## DP運指推定

標準のadaptive key-count curveは現在:

```text
2K → 3K → 4K → 6K → 8K → 10K → 12K → 16K → 24K → 32K → 36K
```

です。5K/7Kなども明示指定すれば解析できます。内部APIは64Kまで受け付けます。

高Kのデフォルトモデルは左右を均等に分けた抽象キー資源です。32Kは `L16..L1 / R1..R16`、36Kは `L18..L1 / R1..R18` です。これは32本/36本の物理的な人間の指を意味しません。実際のキーボード配置が不明な場合の入力資源近似です。

現在のDPは平均コストだけでなく、rolling local peak (`peakLocalCostPerPress`) も記録します。4Kで全体平均が低くても、局所burstが6Kで大幅に軽くなる場合は4Kを十分とは判定しにくくします。

2キーの通常交互は `LI ↔ RI` を優先し、3Kでは `LI / RI / RM` を使って三連系ロールを表現します。

### Lane と physical finger

`fingering-dp-v0.8` では、キー/lane数と物理的な指を別の状態として扱えます。

```text
Lane / key
   ↓ mapped to
Physical finger
```

実配置が分かる場合はJSON入力へ `laneFingerMap` と、必要なら `laneLabels` を渡します。同じ物理指を複数laneへ割り当てても構いません。

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

この例では16 laneですが物理指は10本です。DP内部では:

- `lastUse` / 再使用ペナルティをlaneではなく物理指ごとに追跡する
- 同じ物理指に割り当てられた別laneへ移るときだけ、小さい `laneSwitchWeight` / `laneJumpWeight` を加える
- 同時押し中は、同じ物理指を2回使えない
- lane数が多いだけで物理的な同時入力能力が増えたことにはしない
- 手全体を移動する一般的な「hand reposition cost」は入れない。基本的に手は固定したまま、参加する指とlaneが変わるモデルにする

という扱いになります。上の16-lane例で11同時押しを与えると、16 laneあることを理由に成功扱いせず、10本の物理指制約で `SIMULTANEOUS_PRESS_COUNT_EXCEEDS_PHYSICAL_FINGERS` になります。

出力には `laneProfile`, `physicalFingerProfile`, `physicalFingerCount`, `laneCounts`, `fingerCounts`, `laneSwitchRate` を含めます。Replay互換のため `fingerProfile` は現在lane表示用profileとしても残しています。traceには `lane` / `laneLabel` と `physicalFinger` / `physicalFingerLabel` の両方を出します。

`laneFingerMap` を使った結果には情報用warning `CUSTOM_LANE_FINGER_MAP` が付きます。エラーではありません。

## Replay Viewer

Replayはタイミング、譜面形状、惑星位置、Twirl、SetSpeed、推定運指を同じ再生クロックで表示します。

高KのKey Viewerは左右ブロックへ分割し、32K/36Kでは自動的にcompact表示します。狭い画面では各側を複数段に折り返して、画面外へはみ出さないようにします。

本家Texture2Dを書き出している場合は次のアセットを利用できます。

- `tile_unlit.png`
- `planet-red.png`
- `planet-blue.png`
- `swirl_red.png`
- `swirl_blue.png`
- `SetSpeed.png`
- `SpeedDown.png`
- `tile_samespeed.png`

ゲーム素材自体はELF repoへコミットしません。ローカルで読み込んでstandalone HTMLへ埋め込みます。

## .adofai timing extractor

現在のextractorは主に次を処理します。

- `angleData`
- 旧形式 `pathData`
- `Twirl`
- `SetSpeed` (`Multiplier` / absolute BPM)
- `settings.bpm`
- `settings.pitch`
- midspin (`999` / `!`)
- `Pause`
- `Hold` の時間長

`settings.offset` と `countdownTicks` は再生メタデータとして保持しますが、運指の相対入力間隔には足しません。

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
- `BEAM_PRUNED`

`EXTREME_KEY_COUNT` は「人間には不可能」という意味ではなく、現在の自動探索範囲/モデルでは十分な運指を見つけられなかった、という警告です。

## AnalyzerとRating

Analyzer結果はVersion単位のEvidenceです。

```text
Level
└─ Variant
   └─ Version
      ├─ Human rating evidence
      ├─ References
      ├─ External evidence
      └─ Analyzer evidence
```

Analyzerは`canonical_ratings`を書き換えません。将来`analyzer_runs` / `analyzer_predictions`へ保存する場合も、この原則を維持します。
