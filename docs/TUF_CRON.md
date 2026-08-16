# TUF 定期取り込み

[English](en/TUF_CRON.md)

ELF の API Worker は Cloudflare Cron Trigger から TUF v2 データを定期取得します。

## スケジュール

現在の Cron 式は次です。

```text
17 * * * *
```

Cloudflare Cron Trigger は UTC 基準なので、**毎時17分 (UTC)** に実行されます。日本時間では毎時17分のままです（分だけを指定しているため、タイムゾーン差で分は変わりません）。

Cron 式は次の2か所で同じ値を持ちます。

- `apps/api/wrangler.jsonc` — 通常の Worker 設定
- `scripts/production-config.mjs` — 本番用に生成する Wrangler 設定

変更する場合は両方を同時に更新し、`npm test` を実行してください。

## 実行経路

```text
Cloudflare Cron Trigger
        |
        v
apps/api/src/worker.ts :: scheduled()
        |
        v
runTufImport()
        |
        +--> fetchConsistentTufSnapshot()
        |
        v
importTufSnapshot()
        |
        v
PostgreSQL external_* / import_* tables
```

HTTP リクエストは従来どおり同じ Worker の `fetch: app.fetch` から処理します。

Cron は人間の管理者セッションを使いません。`actorId` は `null` とし、システム実行として扱います。通常の `TUF_IMPORT` 監査に加え、定期実行では `TUF_SCHEDULED_IMPORT` も記録し、Cron 式と予定実行時刻を残します。

## データ境界

定期取り込みも手動取り込みと同じ TUF fetch/import コアを使います。

定期実行が保存するのは外部観測値だけです。

- `import_snapshots`
- `external_level_observations`
- `external_rating_observations`
- `external_reference_observations`
- `import_issues`
- 必要に応じた `external_level_ids` の SHA-256 完全一致リンク

**`canonical_ratings` と `difficulty_references` は定期取り込みから変更しません。** TUF の難易度が ELF の確定難易度へ自動昇格することもありません。

## ローカル確認

`npm run dev:api` は Wrangler を `--test-scheduled` 付きで起動します。

```powershell
npm run dev:api
```

別ターミナルから次を実行すると scheduled handler を手動で呼べます。

```powershell
curl.exe "http://localhost:8787/cdn-cgi/handler/scheduled?format=json"
```

これは模擬表示だけではなく、**実際に TUF を取得してローカルDBへスナップショットを書き込みます**。

通常の静的確認は外部 API を呼ばず、次で行います。

```powershell
npm test
```

`scripts/smoke-cron.mjs` が Worker entrypoint、Cron 設定、システム実行経路、外部データ境界を検査します。

## 本番デプロイ

`npm run production:setup` / `npm run production:deploy` が生成する API Wrangler 設定にも同じ Cron Trigger が含まれます。別途 Cloudflare Dashboard から手動で Cron Trigger を追加する必要はありません。

Wrangler 管理の Worker では Cron Trigger も Wrangler 設定を正本として扱います。
