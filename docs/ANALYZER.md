# Analyzer

[English](en/ANALYZER.md)

ELF Analyzerは、確定難易度を自動決定する機能ではありません。Versionごとの機械的な解析結果を、人間の査定に使う補助Evidenceとして生成します。

> Analyzer output must never directly create or modify a canonical rating.

## ワンコマンド実行

通常は `.adofai` を1個渡すだけです。

```powershell
npm run analyzer:fingering -- .\WYSI.adofai
```

同じフォルダに自動で生成します。

```text
WYSI-result.json
WYSI-replay.html
```

`.adofai` → timing抽出 → 運指DP → JSON保存 → Replay HTML生成まで連続実行します。

Replay用Texture2Dは次の順に自動探索します。

1. `--assets <dir>`
2. `ELF_ADOFAI_ASSETS`
3. `.adofai` と同じ場所の `Texture2D/`
4. `.adofai` と同じ場所
5. カレントディレクトリの `Texture2D/`
6. カレントディレクトリ
7. `scripts/analyzer/replay-assets/`

見つからないTextureは個別にvector fallbackされます。

必要な場合のみ `--output-dir` / `--html` / `--stdout` / `--no-view` を指定できます。

## 運指モデル

標準のadaptive key-count curveは次です。

```text
2K → 3K → 4K → 6K → 8K → 10K → 12K → 16K → 24K → 32K
```

5K/7Kは明示指定時のみ利用できます。人間運指の自動探索は32Kまで行い、個別の `estimateFingeringForKeyCount` は引き続き64Kまで受け付けます。

- 2キーの自然な交互では `LI ↔ RI` を優先
- 3Kは `LI / RI / RM` として三連系ロールを表現
- 平均コストだけでなく `peakLocalCostPerPress` で局所負荷を見る
- larger-K lookaheadで、短い6K相当burstを4K平均値で隠さない

`STANDARD_FINGERING_MODEL_OUT_OF_RANGE` は「通常10K以内ではpractical thresholdに収まらない」ことを示す警告です。`EXTREME_KEY_COUNT` は32Kまで自動探索してもpracticalな運指が見つからない場合に使います。

## .adofai timing extractor

現在は次を処理します。

- `angleData`
- 旧形式 `pathData`
- `Twirl`
- `SetSpeed` (`Multiplier` / absolute BPM)
- `settings.bpm`
- `settings.pitch`
- midspin (`999` / `!`)
- `Pause` duration
- `Hold` duration（時間長のみ）

`.adofai` の末尾カンマにも対応します。

`settings.offset` と `countdownTicks` は再生開始位置のメタデータとして残しますが、運指の相対入力間隔には足しません。

### 現在の近似

- `HOLD_INPUT_SEMANTICS_APPROXIMATE`
- `MULTIPLANET_PRESS_COUNT_NOT_MODELED`
- `AUTOPLAY_TILE_INPUT_NOT_MODELED`

これらのwarningがある結果は、通常譜面と同じ精度として扱わない前提です。

## Replay

生成されたHTMLはstandaloneで、次を表示します。

- 譜面形状
- 惑星位置
- Twirl / SetSpeed
- floor / BPM / direction
- DP運指Key Viewer
- play / pause / seek / speed / zoom

AssetStudio/AssetRipperで書き出した次のTexture2Dがあれば自動利用します。

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

ゲーム素材自体はELF repoにはコミットしません。

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
