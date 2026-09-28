# @management-bot/session-cleanup

Dashboardの`sessions`テーブルから、`expires_at`を過ぎた(期限切れの)セッション行を`SESSION_CLEANUP_CRON`のスケジュールで削除する。

## 環境変数

| 変数 | 説明 | デフォルト |
| --- | --- | --- |
| `DATABASE_URL` | 対象のPostgres接続文字列 | (必須) |
| `SESSION_CLEANUP_CRON` | cron式 (タイムゾーン: Asia/Tokyo固定) | `30 4 * * *` (毎日4:30 JST) |

期限切れセッションはログイン判定・トークン取得のどちらにも使われないため、削除してもログイン中のユーザーには影響しない。
