# @management-bot/logging-retention

`log_retention_settings`でguild×categoryごとに設定された保持期間(日数)を過ぎた`log_entries`を`LOGGING_RETENTION_CRON`のスケジュールで削除する。

## 環境変数

| 変数 | 説明 | デフォルト |
| --- | --- | --- |
| `DATABASE_URL` | 対象のPostgres接続文字列 | (必須) |
| `LOGGING_RETENTION_CRON` | cron式 (タイムゾーン: Asia/Tokyo固定) | `0 4 * * *` (毎日4:00 JST) |

保持期間が`0`(無期限)、または設定自体が存在しないguild×categoryは削除対象にしない。
