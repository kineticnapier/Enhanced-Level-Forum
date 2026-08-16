# アーキテクチャ

[English](en/ARCHITECTURE.md)

## 信頼境界

```text
公開ブラウザ                         運営ブラウザ
      |                                 |
      v                                 v
enhanced-level-forum-web Worker       enhanced-level-forum-admin Worker
      |                                 |
      +-------------- HTTPS ------------+
                     |
                     v
               enhanced-level-forum-api Worker
                     |
                 Hyperdrive
                     |
                     v
                 PostgreSQL
```

公開・管理フロントエンドにDB認証情報は渡しません。すべての変更はAPIとロール確認を通ります。

## 確定判断と判断材料

重要な区別は「公式ユーザー / 非公式ユーザー」ではなく、**決定 / 判断材料**です。

確定判断:

```text
canonical_ratings
  family = G
  tier   = 9
```

人間の判断材料:

```text
rating_votes
  family      = G
  anchor_tier = 9
  lean        = +1  # G10寄り
  confidence  = 4/5
```

外部の判断材料:

```text
import_snapshots
external_level_observations
external_rating_observations
external_reference_observations
import_issues
```

機械による判断材料:

```text
analyzer_runs / analyzer_predictions
```

`canonical_ratings` を変更できるのは運営の難易度変更手順だけです。

## 外部取り込みの境界

外部サービスは観測元であり、ELFの正本を直接書く別ライターではありません。

TUF取り込みは次を行います。

1. 公開 TUF v2 の譜面ページとReference一覧を取得、または同形式のテストfixtureを受け取る。
2. 元ペイロード全体を `import_snapshots` に保存。
3. 外部譜面・難易度・Referenceを正規化して観測行として保存。
4. P/G/U以外の特殊ラベルをELFのP/G/Uへ変換せず保存。
5. 不正、重複、矛盾した元データを `import_issues` に記録。
6. 既存の外部ID対応、または SHA-256 が `LevelVersion` と完全一致した場合だけELF譜面に結び付ける。

importerはELF譜面を勝手に作らず、確定難易度を公開せず、ELFの基準譜面を作成・移動しません。静的チェックでも importer が `canonical_ratings` と `difficulty_references` に依存しないことを確認します。

`external_level_ids` が取得元IDの永続対応表です。SHA-256完全一致なら安全に対応を確立できます。既存の取得元ID対応とSHA一致先が食い違う場合は、黙って付け替えず取り込みエラーとして記録します。

## 基準譜面

基準譜面であることと、その譜面の難易度は別の情報です。

難易度変更時は:

1. 以前の現行確定難易度を閉じる。
2. 新しい整数の確定難易度を追加。
3. 同じ `LevelVersion` に付いた `ACTIVE` な基準譜面を取得。
4. family/tierが基準譜面の位置と一致しなくなったものを `NEEDS_REVIEW` に変更。
5. 基準譜面履歴と監査ログを記録。

これにより「基準譜面だから難易度変更できない」という依存関係を作りません。

## ロール

- `VIEWER`: ログイン済み利用者。提案作成・提案への投票。
- `RATER`: 加えて難易度評価を投稿可能。
- `REFERENCE_MANAGER`: 加えて基準譜面・取り込みデータを管理可能。
- `MODERATOR`: 加えて確定難易度変更、提案決定、監査ログ閲覧。
- `ADMIN`: 加えてユーザー作成・権限管理。

## 今後の統合先

外部観測レイヤーはTUFで利用中です。今後の候補:

- 未照合の外部譜面IDを人間が照合するUI
- TUF取得データの差分・難易度変更通知
- Clastar Galaxyを同じ外部観測レイヤーへ正規化
- 基準譜面の重複・カバレッジ検査
- Analyzerサービス認証と予測値取り込み
