# v0.2.5 マイグレーション修正

[English](en/MIGRATION_FIX_0.2.4.md)

## 症状

`npm run db:migrate` が `references` 付近で PostgreSQL エラー `42601` により失敗します。

## 原因

`REFERENCES` は PostgreSQL SQL 文法の一部です。引用符なしの `references` をテーブル名にすると、`CREATE TABLE references (...)` などが不正になります。

## 修正

DBテーブル名を `difficulty_references` に変更しました。API URLとTypeScriptレスポンスのプロパティ名は従来どおり (`/api/references`, `references`) です。

`001_initial.sql` は `BEGIN` / `COMMIT` で囲まれているため、失敗した v0.2.3 適用はschema変更ごとrollbackされます。migration runnerがファイル適用前に作るため `schema_migrations` だけ残っていることがありますが問題ありません。DB作り直しは不要です。

実行:

```powershell
$env:DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/adoforum"
npm run db:migrate
```
