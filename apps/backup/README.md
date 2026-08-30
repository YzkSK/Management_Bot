# @management-bot/backup

`pg_dump`を`BACKUP_CRON`のスケジュールで定期実行し、`BACKUP_DIR`にgzip圧縮したSQLダンプを保存する。`BACKUP_RETENTION_DAYS`より古いダンプは実行のたびに削除する。

## 環境変数

| 変数 | 説明 | デフォルト |
| --- | --- | --- |
| `DATABASE_URL` | バックアップ対象のPostgres接続文字列 | (必須) |
| `BACKUP_CRON` | cron式 (タイムゾーン: Asia/Tokyo固定) | `0 3 * * *` (毎日3:00 JST) |
| `BACKUP_DIR` | ダンプ保存先ディレクトリ | `/backups` |
| `BACKUP_RETENTION_DAYS` | ダンプ保持日数 | `7` |

## リストア手順

1. 対象のダンプファイルを`backup-data`ボリュームまたはホストから取得する。

   ```sh
   docker compose exec backup ls /backups
   docker compose cp backup:/backups/management_bot-<timestamp>.sql.gz .
   ```

2. 復元先のPostgresが起動していることを確認する(既存データを上書きする場合は事前に停止・バックアップを取ること)。

3. ダンプを展開してリストアする。

   ```sh
   gunzip -c management_bot-<timestamp>.sql.gz | docker compose exec -T postgres \
     psql -U management_bot -d management_bot
   ```

   別ホストや素のPostgresへリストアする場合:

   ```sh
   gunzip -c management_bot-<timestamp>.sql.gz | psql "$DATABASE_URL"
   ```

4. `bot` / `dashboard-api`を再起動し、正常に接続できることを確認する。
