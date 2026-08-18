# Analyzer

[English](en/ANALYZER.md)

ELF Analyzerは、確定難易度を自動決定する機能ではありません。Versionごとの機械的な解析結果を、人間の査定に使う補助Evidenceとして生成します。

> Analyzer output must never directly create or modify a canonical rating.

## v0.2: .adofai → 入力時刻 → DP運指推定

現在のAnalyzerは `.adofai` を直接読み込み、譜面の入力時刻を復元してから複数キー数で運指を推定します。

```text
.adofai
↓
angleData / pathData
↓
Twirl / SetSpeed / pitch / midspin
↓
入力時刻列
↓
beam-pruned dynamic programming
↓
2K / 4K / 6K / 8K / 10K / 12K / 16K / 24K ...
↓
key-count curve + warnings
```

巨大譜面ではDP探索量が大きくなるため、現段階ではCloudflare WorkerではなくローカルCLIで実行します。

## 実行

`.adofai` を直接解析できます。

```powershell
npm run analyzer:fingering -- .\level.adofai
```

結果をJSONへ保存する場合:

```powershell
npm run analyzer:fingering -- .\level.adofai .\result.json
```

従来の抽出済みtiming JSONも引き続き利用できます。

```powershell
npm run analyzer:fingering -- .\timings.json
```

## .adofai timing extractor

`adofai-timing-v0.2` は次を処理します。

- `angleData`
- 旧形式 `pathData`
- `Twirl`
- `SetSpeed`
  - `Multiplier`
  - absolute BPM (`beatsPerMinute`)
- `settings.bpm`
- `settings.pitch`
- midspin (`999` / `!`)
- `Pause` のduration
- `Hold` のduration（時間長のみ）

`.adofai` に存在する末尾カンマにも対応します。

`settings.offset` と `countdownTicks` は再生開始位置のメタデータとして結果に残しますが、運指の相対入力間隔には足しません。

### 現在の近似

`Hold` は次の入力までの時間には反映しますが、「どの指を何ms押し続けるか」という占有状態はまだDPに入れていません。そのため:

- `HOLD_INPUT_SEMANTICS_APPROXIMATE`

を出します。

`MultiPlanet` は現時点で必要入力数を正確に復元していないため:

- `MULTIPLANET_PRESS_COUNT_NOT_MODELED`

を出します。

`AutoPlayTiles` も自動入力区間をまだ除外していないため:

- `AUTOPLAY_TILE_INPUT_NOT_MODELED`

を出します。

これらのwarningがある結果は、通常譜面と同じ精度として扱わない前提です。

## timing出力

`.adofai` 入力時はAnalyzer JSONに `timing` が追加されます。

主なフィールド:

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

`segments` には各区間のBPM、移動角度、beat長、hit時刻などを保存するため、タイミング復元のデバッグにも使えます。

## 直接timing入力

単押し列:

```json
{
  "levelVersionId": "optional-version-id",
  "sha256": "optional-sha256",
  "hitTimesMs": [0, 100, 200, 300],
  "keyCounts": [2, 4, 6, 8, 10, 12, 16, 24]
}
```

同時押しを明示する場合:

```json
{
  "events": [
    { "timeMs": 0, "presses": 1 },
    { "timeMs": 100, "presses": 3 },
    { "timeMs": 200, "presses": 1 }
  ]
}
```

`hitTimesMs`で同じ時刻が複数回現れた場合も同時押しとしてまとめられます。

## DP状態

現在の状態は主に次を保持します。

- 各指/キーが最後に使われた時刻
- 直前に使った指
- 各指の使用回数
- 各指の最小再使用間隔
- 同指連続回数
- 指切り替え回数
- 最大再使用ペナルティ

各入力に対して候補指へ遷移し、低コスト状態だけをbeamに残します。そのため厳密な全探索ではなく、決定論的な近似DPです。

## コスト

現在のコストは仮仕様です。主に次を含みます。

- 短時間で同じ指を再使用するペナルティ
- 指位置の移動距離
- 同じ指を連続使用する小さな追加ペナルティ

この係数は将来、実際のRater運指データから調整します。

## key-count curve

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

出力には次が含まれます。

- `estimatedMinKeys`: practical thresholdを初めて満たすキー数
- `comfortableKeys`: より低いcomfortable thresholdを初めて満たすキー数
- `keyCountCurve`: 各キー数のコストと運指統計

これらは難易度そのものではありません。

## Analyzer warnings

運指DP側では次の警告を出せます。

- `STANDARD_FINGERING_MODEL_OUT_OF_RANGE`
- `MULTI_KEYBOARD_LIKELY`
- `EXTREME_KEY_COUNT`
- `HIGH_SIMULTANEOUS_PRESS_COUNT`
- `BEAM_PRUNED`

Timing extractor側のwarningとは別に保持されます。

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

## 今後

次に必要なもの:

1. 実譜面とのタイミング照合テストを増やす
2. `Hold` の指占有状態
3. `MultiPlanet` の入力列復元
4. 局所burst / stamina / percentile feature
5. 実際の運指データによるコスト校正
6. Analyzer結果のDB保存とAdmin表示
7. P/G/U family classifier + tier regressor

難易度モデルを追加しても、確定難易度の最終決定は人間側に残します。
