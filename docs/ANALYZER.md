# Analyzer

[English](en/ANALYZER.md)

ELF Analyzerは、確定難易度を自動決定する機能ではありません。Versionごとの機械的な解析結果を、人間の査定に使う補助Evidenceとして生成します。

> Analyzer output must never directly create or modify a canonical rating.

## v0.1: DP運指推定

最初のAnalyzerは、入力タイミング列から複数キー数で運指を推定します。

```text
入力タイミング
↓
beam-pruned dynamic programming
↓
2K / 4K / 6K / 8K / 10K / 12K / 16K / 24K ...
↓
各キー数の最小推定コスト
↓
key-count curve + warnings
```

巨大譜面をCloudflare Worker上で直接解析するとCPU制限に当たりやすいため、v0.1はローカルCLIとして実行します。

## 入力

現在はADOFAIファイルそのものではなく、譜面から抽出済みの入力時刻を受け取ります。

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

## 実行

```powershell
npm run analyzer:fingering -- .\timings.json
```

ファイルへ保存する場合:

```powershell
npm run analyzer:fingering -- .\timings.json .\result.json
```

## DP状態

v0.1の状態は主に次を保持します。

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

この係数は将来、実際のRater運指データから調整する予定です。

## key-count curve

同じ入力列を複数のキー数で解析します。

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

これらは難易度そのものではありません。たとえば12Kが必要と推定されても、それだけでU系の特定tierになるわけではありません。

## warnings

v0.1では次の警告を出せます。

- `STANDARD_FINGERING_MODEL_OUT_OF_RANGE`: 10K以下でpractical thresholdを満たさない
- `MULTI_KEYBOARD_LIKELY`: practical thresholdに11K以上が必要
- `EXTREME_KEY_COUNT`: 指定した最大キー数でもpractical thresholdを満たさない
- `HIGH_SIMULTANEOUS_PRESS_COUNT`: 10を超える同時押しが存在
- `BEAM_PRUNED`: 探索候補をbeam幅で削った

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

v0.1の次に必要なもの:

1. `.adofai`から正確な入力タイミングを抽出するparser
2. SetSpeed / Twirl / Midspin / MultiPlanet等を含むイベント解釈
3. 局所burst / stamina / percentile feature
4. 実際の運指データによるコスト校正
5. Analyzer結果のDB保存とAdmin表示
6. P/G/U family classifier + tier regressor

難易度モデルを追加しても、確定難易度の最終決定は人間側に残します。
