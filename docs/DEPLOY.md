# Cloudflare 本番デプロイ

[English](en/DEPLOY.md)

ELF本番環境は3つのCloudflare Workersと外部PostgreSQLで構成します。初回デプロイに購入済みの独自ドメインは**不要**です。

既定はCloudflareアカウントの `workers.dev` サブドメインを使います。

```text
enhanced-level-forum-web.<account>.workers.dev    -> 公開 React SPA
enhanced-level-forum-admin.<account>.workers.dev  -> 運営 React SPA
enhanced-level-forum-api.<account>.workers.dev    -> Hono API Worker
                                                       |
                                                       v
                                               Hyperdrive -> PostgreSQL
```

後からDBやHyperdriveを作り直さず、同じ環境を独自の兄弟ドメインへ移行できます。

デプロイ用ツールはDB認証情報、ログイン制限salt、初期ADMINパスワード、生成Wrangler設定をGit管理外にします。

## 必要なもの

- Node.js 20+
- `npm install` 済み
- Workersが有効なCloudflareアカウント
- そのアカウントで認証済みのWrangler
- Hyperdriveから到達可能なPostgreSQL
- 既定モードではアカウントの `workers.dev` サブドメイン名

`workers_dev` が有効なWorkerは `<worker-name>.<account-subdomain>.workers.dev` 形式になります。ELFの3つのWorker名は固定なので、デプロイ前にURLを決定できます。

本番Cookieは host-only の `__Host-elf_session`, `SameSite=Lax` です。どちらのデプロイモードでも公開/管理/APIを同一site配下のHTTPS兄弟ホストにします。

## 1. ローカル本番設定を作る

リポジトリ直下で:

```powershell
Copy-Item .env.production.example .env.production
```

独自ドメインなしで開始する場合:

```dotenv
ELF_DEPLOY_MODE=workers_dev
ELF_WORKERS_DEV_SUBDOMAIN=your-account-subdomain

# workers_dev モードでは空欄のまま。
ELF_PUBLIC_ORIGIN=
ELF_ADMIN_ORIGIN=
ELF_API_ORIGIN=

DATABASE_URL=postgres://USER:PASSWORD@HOST:5432/adoforum?sslmode=require

# 初回は空欄。production:setup が Hyperdrive 作成後に埋める。
ELF_HYPERDRIVE_ID=
ELF_HYPERDRIVE_NAME=enhanced-level-forum-db

# 32文字以上の高エントロピーなランダムsecret。
AUTH_RATE_LIMIT_SALT=

ELF_ADMIN_EMAIL=admin@example.com
ELF_ADMIN_NAME=ELF Administrator
ELF_ADMIN_PASSWORD=
```

CloudflareダッシュボードでアカウントURLが

```text
https://hello.workers.dev
```

なら:

```dotenv
ELF_WORKERS_DEV_SUBDOMAIN=hello
```

`hello.workers.dev` と書いても `hello` に正規化します。

`.env.production` はgitignoredです。commitしたり、秘密値を追跡対象Wrangler設定へコピーしたりしないでください。

## 2. 初回Cloudflare / DBセットアップ

```powershell
npm run production:setup
```

このコマンドは:

1. デプロイモードと算出/指定originを検証。
2. DB変更前に `wrangler whoami` を実行し、アカウント/ログイン失敗を先に検出。
3. `ELF_HYPERDRIVE_ID` が空ならHyperdriveを作成。
4. 返されたIDをGit管理外の `.env.production` に保存。
5. 未適用PostgreSQLマイグレーションを適用。
6. 認証情報が指定されていれば初期ADMINを作成。
7. API/公開/管理用の本番Wrangler設定を生成。

`workers_dev` モードでは算出した3つのURLを表示します。Cloudflare DNS zoneや購入済みドメインは不要です。

PostgreSQL接続文字列はセットアップログで伏字になります。Hyperdrive作成のためWranglerには直接渡されます。

本番は `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` を無視し、初期ADMINはDBへ別経路で作ります。

既存Hyperdriveを使う場合は事前に `ELF_HYPERDRIVE_ID` を設定すると新規作成を飛ばします。

## 3. 生成されるWrangler設定

`production:setup` と `production:deploy` は次を生成します。

```text
apps/api/wrangler.production.generated.json
apps/web/wrangler.production.generated.json
apps/admin/wrangler.production.generated.json
```

すべてGit管理外で、`.env.production` から再生成できます。

### workers.dev モード

`ELF_DEPLOY_MODE=workers_dev` の場合:

- 3設定とも `workers_dev=true`
- Custom Domain の `routes` は生成しない
- Preview URLは `preview_urls=false` で無効化
- API CORS originは算出した公開/管理 `workers.dev` URL
- フロントエンドは算出したAPI `workers.dev` URL向けにビルド

### Custom Domain モード

`ELF_DEPLOY_MODE=custom_domain` の場合:

- `ELF_PUBLIC_ORIGIN`, `ELF_ADMIN_ORIGIN`, `ELF_API_ORIGIN` が必須
- 3つは同一siteのHTTPS兄弟originである必要がある
- 生成設定はCustom Domain routeを使用
- `workers_dev=false`, `preview_urls=false`

API設定には常に `ENVIRONMENT=production`, `HYPERDRIVE` binding, observability、および必須secret `AUTH_RATE_LIMIT_SALT` が入ります。フロントエンドは Workers Static Assets + SPA fallback です。

## 4. 3つのWorkerをデプロイ

```powershell
npm run production:deploy
```

処理内容:

1. `.env.production` を検証し、本番Wrangler設定を再生成。
2. shared/APIをビルド。
3. Wranglerのsecrets-file経由で `AUTH_RATE_LIMIT_SALT` を渡してAPIをデプロイ。
4. `VITE_API_URL=<ELF_API_ORIGIN>/api` で2つのReactフロントエンドをビルド。
5. 公開/管理Static Asset Workerをデプロイ。
6. 一時的なローカルWorker secretファイルを `finally` で削除。

workers.devモードのURL例:

```text
https://enhanced-level-forum-web.hello.workers.dev
https://enhanced-level-forum-admin.hello.workers.dev
https://enhanced-level-forum-api.hello.workers.dev
```

## 5. 本番smoke test

```powershell
npm run production:smoke
```

確認内容:

- API `/api/health` とDB接続
- 公開/管理画面がHTMLを返す
- 公開譜面カタログが応答
- 信頼していないブラウザOriginを403で拒否
- 設定した2つのフロントエンドoriginへcredentials付きCORS preflightを返す
- ローカルに本番ADMIN認証情報が残っていればログインし、Cookieが `__Host-elf_session; Secure; HttpOnly; SameSite=Lax; Path=/` かつ `Domain` なしであること
- `/api/auth/me` がADMINとして解決されること

最後に:

```text
PRODUCTION DEPLOY SMOKE PASSED
```

成功後、繰り返しログインsmokeに不要なら `.env.production` から `ELF_ADMIN_PASSWORD` を削除してください。DBにはハッシュのみ保存されています。

## 6. 後から独自ドメインへ移行

新しいDB、ADMIN、Hyperdriveは不要です。Cloudflareアカウントにドメインを追加し、`.env.production` を変更します。

```dotenv
ELF_DEPLOY_MODE=custom_domain
ELF_PUBLIC_ORIGIN=https://forum.example.com
ELF_ADMIN_ORIGIN=https://admin.example.com
ELF_API_ORIGIN=https://api.example.com
```

既存の `DATABASE_URL`, `ELF_HYPERDRIVE_ID`, secrets は維持し:

```powershell
npm run production:deploy
npm run production:smoke
```

生成Wrangler設定が `workers_dev=true` / routeなしから、Custom Domain route / `workers_dev=false` へ切り替わります。

古い `workers.dev` originを手動でフロントエンドに残さないでください。`production:deploy` が新しいAPI origin向けに再ビルドします。

## 7. 再デプロイ

通常のコード更新ではHyperdriveやADMINを作り直しません。

```powershell
git pull
npm install
npm test
npm run production:deploy
npm run production:smoke
```

新しいDBマイグレーションがある場合は、それを必要とするコードより先に本番DBへ適用します。

```powershell
$env:DATABASE_URL="<production connection string>"
npm run db:migrate
Remove-Item Env:DATABASE_URL
```

または `npm run production:setup` を再実行できます。適用済みマイグレーション・既存の有効ADMINについては冪等です。

## 8. 管理画面へのCloudflare Access

独自ドメインの管理画面はCloudflare Accessで追加保護できます。ただし多層防御にすぎず、APIは引き続きELFのロールを検証します。Accessをアプリの認可として扱わないでください。

## 9. 失敗時の確認

### ドメインを持っていない

```dotenv
ELF_DEPLOY_MODE=workers_dev
ELF_WORKERS_DEV_SUBDOMAIN=<your Cloudflare account subdomain>
```

Custom Domain routeは生成されません。

### Hyperdrive作成後にID解析だけ失敗した

Wrangler出力にあるIDを:

```dotenv
ELF_HYPERDRIVE_ID=<id>
```

へ入れ `npm run production:setup` を再実行します。別のHyperdriveは作りません。

### workers.dev のURLが違う

アカウントの Workers & Pages サブドメインを確認します。`ELF_WORKERS_DEV_SUBDOMAIN` はWorker名ではなくアカウントラベルです。`hello.workers.dev` なら `hello` を使います。ELFのWorker名は自動で前置されます。

### Custom Domainデプロイが失敗する

`ELF_DEPLOY_MODE=custom_domain` と、3つのホスト名が認証中Wranglerアカウントから利用できるCloudflare zoneに属することを確認します。

### APIデプロイは成功したがブラウザログインできない

次を確認します。

- 3 URLがすべてHTTPSで同一siteの兄弟ホスト
- フロントエンドが古いローカルビルドではなく `production:deploy` で作られたもの
- `AUTH_RATE_LIMIT_SALT` がアップロード済み
- `/api/health` が `database:true`
- workers.devモードなら3 Workerが同じアカウントサブドメイン

### DBマイグレーションが失敗する

成功するまでAPIをデプロイしないでください。本番 `DATABASE_URL` を直し、`production:setup` または `db:migrate` を再実行してからデプロイします。

## ローカル開発は別設定

追跡対象の `apps/*/wrangler.jsonc` はローカル開発向けのままです。`dev:api`, `dev:web`, `dev:admin` は localhost設定を使います。本番コマンドだけが生成済み `wrangler.production.generated.json` を使います。

追跡対象の開発設定に本番Hyperdrive IDを入れないでください。
