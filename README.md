# Enhanced Level Forum (ELF)

**日本語** | [English](README.en.md)

現在の開発バージョン: **v0.3.0**

Enhanced Level Forum は、ADOFAI の難易度を扱うフォーラム兼データベースです。譜面を版ごとに管理し、確定難易度の履歴、難易度変更の提案、再検討可能な基準譜面（Reference）を記録します。

```text
forum.example.com  -> apps/web    React/Vite 公開画面
admin.example.com  -> apps/admin  React/Vite 管理画面
api.example.com    -> apps/api    Hono Cloudflare Worker
                                      |
                                      v
                               Hyperdrive -> PostgreSQL
```

PostgreSQL が正本です。フロントエンドは再生成可能な静的デプロイで、データを書き込むのは API のみです。

## 表示言語

公開画面と管理画面は **日本語 / English** に対応しています。

- 初回はブラウザ言語が日本語なら日本語、それ以外は英語を選びます。
- 画面の言語切替でいつでも変更できます。
- 選択した言語は `localStorage` の `elf_locale` に保存されます。
- 内部の `RERATE`、`NEEDS_REVIEW`、`ADMIN` などの値は変更せず、表示だけを翻訳します。

## 難易度モデル

ELF は、`G9 Mid-High` のような100段階相当の細分化を**公式難易度として公開しません**。

- 確定難易度: `G9` のような整数の `P/G/U` 段階。
- 人間の判断材料: 整数の基準段階 + `-2..2` の5段階の傾き。
- 傾きは内部集計に使えますが、自動的に小数の確定難易度にはなりません。
- 基準譜面の `position_hint` も、説明用の粗い位置情報として同じ尺度を使います。

## データの原則

1. `Level`（譜面）と `LevelVersion`（譜面の版）を分離します。SHA-256 は版に属します。
2. 確定難易度は履歴行として保存し、難易度変更時は以前の現行行を閉じます。
3. 基準譜面も難易度変更できます。確定難易度と位置が矛盾した場合は、変更を止めず基準譜面を `NEEDS_REVIEW`（要確認）にします。
4. コミュニティ評価、確定判断、外部データ、Analyzer 予測は別データとして保持します。
5. TUF / Clastar Galaxy などの取り込み値は、人間の手順で採用されるまでは外部観測値です。
6. 管理操作は監査ログに記録します。

## 新しい環境でのローカルセットアップ

必要なもの:

- Node.js 20+
- PostgreSQL サーバー
- Git

ローカル開発に Cloudflare アカウントは**不要**です。

```powershell
git clone https://github.com/kineticnapier/Enhanced-Level-Forum.git
cd Enhanced-Level-Forum
npm install
npm run setup:local
```

`setup:local` は何度実行しても安全です。次を行います。

- 必要なら `.env.example` から `.env` を作成。
- 既存ファイルを上書きせず、`apps/api/.dev.vars`、`apps/web/.env.local`、`apps/admin/.env.local` を例から作成。
- PostgreSQL に接続。
- データベースがなければ作成。
- 認証強化を含む未適用マイグレーションを適用。

既定の接続先:

```text
postgres://postgres:postgres@127.0.0.1:5432/adoforum
```

既存の開発DBとの互換性のため、内部のデータベース名は引き続き `adoforum` です。プロジェクト名・製品名は ELF です。

PostgreSQL のパスワードが `postgres` でない場合は、初回セットアップ前に接続先を指定します。

```powershell
$env:DATABASE_URL="postgres://postgres:<PASSWORD>@127.0.0.1:5432/adoforum"
npm run setup:local
```

生成される `.env` は Git 管理外です。以後の開発・マイグレーション用スクリプトは `.env` を自動で読みます。

## ローカル起動

リポジトリ直下で3つのターミナルを開きます。

```powershell
npm run dev:api
```

```powershell
npm run dev:web
```

```powershell
npm run dev:admin
```

アクセス先:

- 公開画面: `http://localhost:5173`
- 管理画面: `http://localhost:5174`
- API ヘルスチェック: `http://localhost:8787/api/health`

正常時の例:

```json
{"ok":true,"database":true,"version":"0.3.0"}
```

ブラウザ向けサービスでは `localhost` に統一し、`127.0.0.1` と混在させないでください。ローカルのセッションCookieは `SameSite=Lax` です。

`npm run dev:api` は `.env` の `DATABASE_URL` を読み、Wrangler のローカル Hyperdrive バインディングへ自動で渡します。DBパスワードを `wrangler.jsonc` に書く必要はありません。

## ローカルの初期管理者

`npm run setup:local` は、存在しない場合に `apps/api/.dev.vars` を作成します。

例の認証情報は開発専用です。

```text
Email:    admin@example.com
Password: change-me-immediately
```

`BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` と完全一致するローカルログインがあり、そのメールアドレスのユーザーがまだ存在しない場合だけ初期管理者を作成します。

**`ENVIRONMENT=production` では bootstrap 認証情報を完全に無視します。** 本番管理者はマイグレーション後に別経路で作成します。

```powershell
$env:DATABASE_URL="postgres://USER:PASSWORD@HOST:5432/adoforum?sslmode=require"
$env:ELF_ADMIN_PASSWORD="a-long-unique-password"
npm run auth:create-admin -- --email admin@example.com --name "ELF Admin"
Remove-Item Env:ELF_ADMIN_PASSWORD
```

ログイン制限、アカウント無効化、セッション失効、Cookie の詳細は [docs/SECURITY.md](docs/SECURITY.md) を参照してください。

## TUF 取り込み

TUF importer は公開 TUF v2 の譜面検索・Reference APIを読み、結果を**外部観測値**として保存します。ELF の譜面を勝手に作らず、`canonical_ratings` や `difficulty_references` に直接書き込みません。

マイグレーション適用後、APIを起動して実行します。

```powershell
# terminal 1
npm run dev:api

# terminal 2
npm run import:tuf
```

既定のローカル管理者では `apps/api/.dev.vars` の認証情報を使います。別の認証情報を使う場合:

```powershell
$env:ELF_ADMIN_EMAIL="your-admin@example.com"
$env:ELF_ADMIN_PASSWORD="your-password"
npm run import:tuf
```

保存先:

- 完全な元レスポンス: `import_snapshots`
- 外部譜面ごとの正規化行: `external_level_observations`
- TUF難易度: `external_rating_observations`
- TUF基準譜面情報: `external_reference_observations`
- 不正・曖昧・矛盾したデータ: `import_issues`

TUF ID は、既存の対応表がある場合、または受信した有効な SHA-256 が ELF の `LevelVersion` と完全一致した場合だけ既存譜面に結び付けます。`Impossible` など P/G/U 以外の特殊難易度は外部ラベルのまま保持し、P/G/Uへ強制変換しません。

再現可能なオフラインテストでは `{ "levels": [...], "references": [...] }` を含むJSONを渡せます。

```powershell
npm run import:tuf -- .\path\to\tuf-fixture.json
```

## 認証の安全対策

本番認証には次を実装しています。

- host-only の `__Host-elf_session` Cookie (`Secure`, `HttpOnly`, `SameSite=Lax`)
- 状態変更APIでブラウザ `Origin` を完全一致確認
- PostgreSQL を使った、salt付きメール/IPキーによるログイン試行制限
- アカウントの有効/無効状態
- パスワード変更・管理者による再設定時のセッション失効
- ロール変更時のセッション失効
- 最後の有効な `ADMIN` を無効化・降格できない保護
- 開発専用 bootstrap 認証情報
- 本番管理者の別経路作成

本番Workerには `AUTH_RATE_LIMIT_SALT` secret が必須です。

## テスト

静的チェック・ビルド:

```powershell
npm test
```

DB/API統合テストには現行マイグレーションが必要です。

```powershell
npm run setup:local

# terminal 1
npm run dev:api

# terminal 2
npm run test:e2e
```

E2E は確定難易度、TUFの分離・照合・提案、公開審議API、基準譜面提案の適用、本番認証などを確認します。

## 既存チェックアウトの更新

```powershell
git pull
npm install
npm run setup:local
npm test
```

`setup:local` は既存の秘密情報・設定を上書きせず、適用済みマイグレーションも安全に飛ばします。

## リポジトリ構成

```text
apps/
  api/       Hono Worker + Hyperdrive/Postgres
  web/       公開 React/Vite フロントエンド
  admin/     運営 React/Vite フロントエンド
packages/
  shared/    共通型・難易度の意味定義
db/
  migrations/
scripts/
  setup-local.mjs
  apply-migrations.mjs
  create-admin.mjs
  dev-api.mjs
  import-tuf.mjs
  smoke.mjs
  e2e-smoke.mjs
docs/
  ARCHITECTURE.md
  DEPLOY.md
  API.md
  SECURITY.md
  en/        英語版ドキュメント
```

## 本番デプロイ

Hyperdrive、本番secret、CORS origin、本番管理者、`workers.dev` / Custom Domain、smoke test の詳細は [docs/DEPLOY.md](docs/DEPLOY.md) を参照してください。
