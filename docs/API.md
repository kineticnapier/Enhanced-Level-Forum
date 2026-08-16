# API v0.3

[English](en/API.md)

開発時のベースURL: `http://localhost:8787/api`

ブラウザからは credentials 付き `fetch` を使用します。開発環境のセッションは HttpOnly `elf_session` Cookie、本番環境は host-only の `__Host-elf_session` Cookie を使います。

ブラウザからの状態変更リクエストでは、`Origin` が `WEB_ORIGIN` または `ADMIN_ORIGIN` と完全一致する必要があります。

## 公開 / 認証

- `GET /health`
- `GET /config`
- `GET /stats`
- `GET /auth/me`
- `POST /auth/login`
- `POST /auth/logout`
- `POST /auth/logout-all` — 要ログイン
- `POST /auth/change-password` — 要ログイン

パスワード変更:

```json
{
  "currentPassword": "current passphrase",
  "newPassword": "new passphrase with 12+ chars"
}
```

パスワードを変更すると、そのユーザーの現在以外のセッションをすべて失効させます。

パスワードログインは15分間の窓で回数制限されます。本番では Worker secret `AUTH_RATE_LIMIT_SALT` が必要です。

## 譜面

- `GET /levels?search=&family=&limit=&offset=`
- `GET /levels/:id`
- `POST /levels/:id/votes` — RATER+

難易度評価のbody:

```json
{
  "family": "G",
  "anchorTier": 9,
  "lean": 1,
  "confidence": 4,
  "comment": "G9 referencesより少し上だがG10までは感じない"
}
```

`lean` は `-2,-1,0,1,2` のいずれかで、判断材料にのみ使います。

## 基準譜面

- `GET /references?family=&tier=&status=`
- `GET /references/coverage`

## 提案

互換用ルート:

- `GET /proposals?status=`
- `POST /proposals` — 要ログイン
- `POST /proposals/:id/votes` — 要ログイン

より詳しい公開審議APIは `/governance/*` 配下です。

## 運営 / 管理

- `GET /admin/overview` — REFERENCE_MANAGER+
- `POST /admin/levels` — MODERATOR+
- `PATCH /admin/levels/:id` — MODERATOR+
- `POST /admin/levels/:id/versions` — MODERATOR+
- `POST /admin/levels/:id/ratings` — MODERATOR+
- `POST /admin/references` — REFERENCE_MANAGER+
- `PATCH /admin/references/:id` — REFERENCE_MANAGER+
- `PATCH /admin/proposals/:id/decision` — MODERATOR+
- `GET /admin/users` — ADMIN
- `POST /admin/users` — ADMIN
- `PATCH /admin/users/:id/role` — ADMIN
- `PATCH /admin/users/:id/status` — ADMIN
- `POST /admin/users/:id/reset-password` — ADMIN
- `GET /admin/import-snapshots` — REFERENCE_MANAGER+
- `POST /admin/import-snapshots` — REFERENCE_MANAGER+
- `POST /admin/imports/tuf` — REFERENCE_MANAGER+
- `GET /admin/imports/tuf/summary?snapshotId=<uuid>` — REFERENCE_MANAGER+
- `GET /admin/imports/tuf/issues?snapshotId=<uuid>` — REFERENCE_MANAGER+
- `GET /admin/audit` — MODERATOR+

### ユーザー管理

`POST /admin/users` のパスワードは12〜256文字です。アカウントは既定で有効です。

無効化 / 再有効化:

```json
{ "isActive": false }
```

を `PATCH /admin/users/:id/status` へ送ります。

パスワード再設定:

```json
{ "password": "new long passphrase" }
```

を `POST /admin/users/:id/reset-password` へ送ります。再設定すると対象ユーザーの全セッションを失効させます。ロール変更でも既存セッションを失効させます。最後の有効な `ADMIN` は無効化・降格できません。

## TUF 取り込み

bodyなしの `POST /admin/imports/tuf` は、公開 TUF v2 の譜面検索・Reference APIを取得し、生データ1件と外部観測値を保存します。

再現可能なテスト / オフライン取り込みでは同じエンドポイントに次を渡せます。

```json
{
  "sourceVersion": "fixture:test",
  "rawData": {
    "levels": [],
    "references": []
  }
}
```

受信した有効な SHA-256 が既存 ELF `LevelVersion` と完全一致した場合、importer は `external_level_ids` の対応を作ることがあります。ただし ELF の譜面自体は作らず、`canonical_ratings` や `difficulty_references` に書き込みません。

`G9` などの P/G/U は外部難易度観測として保存します。P/G/U以外の特殊ラベルは `label` / `difficulty_label` に保持し、ELF P/G/Uへ強制変換しません。

重複ID、同一SHAの難易度矛盾、不正なReference行、外部IDとSHA対応の矛盾などは `import_issues` に記録します。

確定難易度変更のbody:

```json
{
  "levelVersionId": "uuid",
  "family": "G",
  "tier": 10,
  "confidence": 0.78,
  "reason": "Accepted rerate proposal #..."
}
```

v0.3 の確定難易度に小数の `value` フィールドはありません。
