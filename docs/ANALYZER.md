# Analyzer

[English](en/ANALYZER.md)

ELF Analyzerは、確定難易度を自動決定する機能ではありません。Versionごとの機械的な解析結果を、人間の査定に使う補助Evidenceとして生成します。

> Analyzer output must never directly create or modify a canonical rating.

## ワンコマンド解析

`.adofai` は1コマンドで、タイミング抽出・運指解析・JSON保存・リプレイHTML生成まで実行できます。

```powershell
npm run analyzer:fingering -- .\WYSI.adofai
```

入力ファイルと同じディレクトリに自動で生成します。

```text
WYSI.adofai
WYSI-result.json
WYSI-replay.html
```

リプレイ用Texture2Dは次の順で自動検出します。

1. `ELF_ADOFAI_ASSETS` 環境変数
2. `.adofai` と同じ場所の `Texture2D/`
3. `.adofai` と同じディレクトリ
4. カレントディレクトリの `Texture2D/`
5. カレントディレクトリ
6. `scripts/analyzer/replay-assets/`

見つからなければベクター表示へ自動フォールバックします。

必要な場合だけ明示指定できます。

```powershell
npm run analyzer:fingering -- .\WYSI.adofai --assets "C:\path\to\Texture2D"
npm run analyzer:fingering -- .\WYSI.adofai --output-dir .\analysis
npm run analyzer:fingering -- .\WYSI.adofai --html .\custom-replay.html
npm run analyzer:fingering -- .\WYSI.adofai --no-view
```

既存の第2位置引数によるJSON出力先指定も互換維持しています。

```powershell
npm run analyzer:fingering -- .\WYSI.adofai .\custom-result.json
```

## 処理フロー

```text
.adofai
↓
angleData / pathData
↓
Twirl / SetSpeed / pitch / midspin
↓
入力時刻列 + track geometry
↓
local-peak-aware hand DP
↓
2K → 3K → 4K → 6K → 8K → 10K → 12K → 16K → 24K
↓
result JSON + replay HTML
```

5K / 7K は明示指定時のみ利用でき、自動探索のbridge pointには使いません。

## 運指モデル

現在の標準プロファイルでは、2キー交互は `LI / RI` を優先し、3Kは `LI / RI / RM` を使います。高速な3連系は3本の指を使うロールとして扱えるようにしています。

DPは主に次を保持します。

- 各指の最終使用時刻
- 直前とその前に使った指
- 左右の手
- 同一手の連続長
- 各指の使用回数と最小再使用間隔
- 短い局所窓のコスト

出力では全体平均 `costPerPress` に加えて `peakLocalCostPerPress` を保存します。これにより、譜面全体では4Kの平均負荷が低くても、一部のburstが6Kで大幅に改善する場合は「4Kで十分」と早期判定しにくくしています。

## .adofai timing extractor

現在のextractorは次を処理します。

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

`Hold` は次の入力までの時間には反映しますが、指の占有状態はまだDPに入れていません。そのため `HOLD_INPUT_SEMANTICS_APPROXIMATE` を出します。

`MultiPlanet` は必要入力数を正確に復元していないため `MULTIPLANET_PRESS_COUNT_NOT_MODELED`、`AutoPlayTiles` は自動入力区間をまだ除外していないため `AUTOPLAY_TILE_INPUT_NOT_MODELED` を出します。

## リプレイ

リプレイHTMLはstandaloneです。以下を表示します。

- 譜面トラック
- 現在floorへのカメラ追従
- 赤/青惑星
- Twirl / SetSpeed
- BPM / direction / floor
- DP推定のキービューワー
- 再生、一時停止、シーク、速度、ズーム

ローカルのゲームTexture2Dが利用できる場合は、床・惑星・Twirl・速度変化アイコンをHTMLへ埋め込みます。ゲーム素材自体はELF repoにはコミットしません。

主に利用するファイル:

- `tile_unlit.png`
- `planet-red.png`
- `planet-blue.png`
- `swirl_red.png`
- `swirl_blue.png`
- `SetSpeed.png`
- `SpeedDown.png`
- `tile_samespeed.png`

## 直接timing JSON入力

抽出済みtiming JSONも引き続き利用できます。この場合、出力先を指定しなければ従来通りstdoutへJSONを出します。

```json
{
  "hitTimesMs": [0, 100, 200, 300],
  "keyCounts": [2, 3, 4, 6, 8]
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
