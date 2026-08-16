# セキュリティ

[English](en/SECURITY.md)

## 認証

- パスワードはランダムsalt付き PBKDF2-SHA256 ハッシュで保存します。
- アカウント管理APIが受け付けるパスワードは12〜256文字です。
- セッショントークンはランダム生成し、PostgreSQLにはそのSHA-256ハッシュだけを保存します。
- セッション有効期限は14日です。
- パスワード変更時、そのユーザーの現在以外のセッションを失効させます。
- 管理者がパスワードを再設定すると対象ユーザーの全セッションを失効させます。
- ロール変更時も既存セッションを失効させ、再ログインを要求します。
- アカウント無効化時はセッションを失効させ、`loadUser` も無効ユーザーを返しません。
- 最後の有効な `ADMIN` は無効化・降格できません。

本番は host-only の `__Host-elf_session` Cookie を使い、`Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/` を設定します。**`Domain` 属性は付けません。** 公開・管理フロントエンドはCookieを直接読む必要がなく、credentials付きリクエストでAPIホストへだけ送信します。

ローカル開発ではHTTP上の `elf_session` を使います。

## ブラウザOrigin / CSRF境界

状態変更API (`POST`, `PUT`, `PATCH`, `DELETE`) では、ブラウザが送る `Origin` が `WEB_ORIGIN` または `ADMIN_ORIGIN` と完全一致する必要があります。不許可のOriginは書き込みルート実行前に403になります。

`Origin` のない明示的なCLI / サービスジョブは許可します。ブラウザはOriginを送る一方、importerなどの保守ツールはブラウザを装わず認証できるためです。

credentials付きCORSでワイルドカードは使いません。

## 定期TUF取り込み

Cloudflare Cron Trigger はブラウザ経由の管理APIや人間の管理者セッションを使わず、Worker の `scheduled()` handler から直接 TUF importer を実行します。

- Cron実行の `actorId` は `null` で、システム実行として扱います。
- `TUF_SCHEDULED_IMPORT` 監査行に Cron 式と予定実行時刻を記録します。
- 定期取り込みは `external_*` / `import_*` の外部観測値だけを扱います。
- `canonical_ratings` / `difficulty_references` は定期取り込み経路から変更しません。
- TUF難易度から確定難易度への反映は、引き続き人間の提案・承認手順が必要です。

詳細は `docs/TUF_CRON.md` を参照してください。

## ログイン試行制限

`004_auth_hardening.sql` が `auth_login_attempts` を追加します。

パスワードログイン失敗は15分間で次の上限があります。

- 正規化メールキーごとに8回
- クライアントIPキーごとに30回

テーブルには生のメールアドレス/IPではなく、salt付きSHA-256の疑似匿名キーを保存します。本番では Worker secret `AUTH_RATE_LIMIT_SALT` が必須です。開発ではテスト用の固定saltを使います。

古い試行行はログイン処理に合わせて適宜削除します。

## 本番の初期管理者

`BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` は **`ENVIRONMENT` が `production` でない場合だけ**受け付けます。ローカル開発互換用です。

本番の最初の管理者は、マイグレーション後に別経路で作ります。

```powershell
$env:DATABASE_URL="postgres://USER:PASSWORD@HOST:5432/adoforum?sslmode=require"
$env:ELF_ADMIN_PASSWORD="use-a-long-unique-password"
npm run auth:create-admin -- --email admin@example.com --name "ELF Admin"
Remove-Item Env:ELF_ADMIN_PASSWORD
```

このスクリプトは既存の非管理者アカウントを勝手に昇格・再有効化せず、パスワードをコマンドライン引数でも受け取りません。

## 管理画面

`admin.example.com` を Cloudflare Access で追加保護しても、API側のロール確認は常に行います。Accessは多層防御であり、アプリケーションの認可状態そのものではありません。

## セキュリティ関連API

- `POST /api/auth/change-password`
- `POST /api/auth/logout-all`
- `PATCH /api/admin/users/:id/status`
- `POST /api/admin/users/:id/reset-password`

ユーザー作成、状態変更、ロール変更、パスワード変更/再設定、認証イベントは監査ログに残します。

## 残作業

- セルフサービス復旧が必要ならパスワード復旧または外部IdP
- 公開ユーザー登録を追加する場合のbot対策
- 提案・コメント自由記述のモデレーション方針
