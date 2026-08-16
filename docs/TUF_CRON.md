# TUF 定期取り込み

[English](en/TUF_CRON.md)

ELF の API Worker は Cloudflare Cron Trigger から TUF v2 データを少量ずつ取得します。

## スケジュール

現在の Cron 式は次です。

```text
*/30 * * * *
```

Cloudflare Cron Trigger は UTC 基準ですが、この式は **30分ごと**なのでタイムゾーンに関係なく毎時 `:00` / `:30` に実行されます。

Cron 式は次の2か所で同じ値を持ちます。

- `apps/api/wrangler.jsonc`
- `scripts/production-config.mjs`

## 小分け取得

TUF API を1回の Cron で全走査しません。1回につき最大 **5ページ = 500譜面**だけ取得し、途中経過を PostgreSQL の staging table に保存します。

```text
30分ごとの Cron
   |
   v
最大5ページ取得
   |
   +-- 成功 --> tuf_crawl_levels に保存して offset を進める
   |
   +-- 502/429/通信失敗 --> その回は諦める。offset は進めない
   |
   v
数回〜十数回かけて全件取得
   |
   +-- References 取得
   |
   v
importTufSnapshot()
   |
   v
完全な import_snapshot と external_* 観測値を公開
```

staging には次を使います。

- `tuf_crawl_state` — 現在の crawl ID、次の offset、観測した total
- `tuf_crawl_levels` — crawl 中に取得した各譜面の raw JSON

途中状態は `import_snapshots` には入りません。そのため、API が途中で落ちても「500件だけの最新 snapshot」が公開されることはありません。

## 整合性

レベル一覧は `RECENT_ASC` で取得します。新規譜面は末尾に増える前提で、total の増加は許容します。

各 Cron 実行の先頭では直前ページを1ページだけ再取得し、staging に保存した ID 列と比較します。途中で削除・並べ替えなどが起きて境界がずれた場合は、その crawl を破棄して次回 `offset=0` からやり直します。total が減少した場合も同様です。

同時に2つの Cron が走った場合は PostgreSQL advisory lock で片方だけを実行します。

## TUF API が落ちた場合

scheduled crawler は1回の実行中に大量retryしません。ページ取得や References 取得に失敗した場合は `DEFERRED` として終了し、次の30分後に同じ位置から再開します。

Worker はこのような想定内の失敗で `controller.noRetry()` を呼び、Cloudflare に即時retryを要求しません。

## データ境界

crawl 完了後に使う本体 importer は従来の `importTufSnapshot()` です。

保存対象は外部観測値だけです。

- `import_snapshots`
- `external_level_observations`
- `external_rating_observations`
- `external_reference_observations`
- `import_issues`
- SHA-256 完全一致時の `external_level_ids` リンク

**`canonical_ratings` と `difficulty_references` は定期取り込みから変更しません。**

Cron は人間の管理者セッションを使わず `actorId: null` で動きます。完成した定期 snapshot には通常の `TUF_IMPORT` に加え `TUF_SCHEDULED_IMPORT` も記録します。

## ローカル確認

新しい staging table があるため、最初に migration を適用してください。

```powershell
npm run setup:local
npm run dev:api
```

別ターミナルから:

```powershell
curl.exe "http://localhost:8787/cdn-cgi/handler/scheduled?format=json"
```

1回呼んでも通常は snapshot 完成まで行かず、最大500件だけ staging に追加します。何度か呼ぶと crawl が進みます。これは dry-run ではありません。

静的確認:

```powershell
npm test
```

## npm の並列化

独立している処理は待ち合わせをやめています。

- `npm run build` — shared / API / public / admin を並列
- `npm run smoke` — 各 static smoke を並列
- `npm test` — 並列 build 完了後、並列 smoke
- `npm run production:deploy` — 4 build を並列、その後 API / public / admin の3 deploy を並列

依存関係のある `build -> smoke` や `build -> deploy` の境界はそのまま直列です。
