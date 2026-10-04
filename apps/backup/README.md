# @management-bot/backup

`pg_dump`を`BACKUP_CRON`のスケジュールで定期実行し、`BACKUP_DIR`にgzip圧縮したSQLダンプを保存する。`BACKUP_RETENTION_DAYS`より古いダンプは実行のたびに削除する。

## 環境変数

| 変数 | 説明 | デフォルト |
| --- | --- | --- |
| `DATABASE_URL` | バックアップ対象のPostgres接続文字列 | (必須) |
| `BACKUP_CRON` | cron式 (タイムゾーン: Asia/Tokyo固定) | `0 3 * * *` (毎日3:00 JST) |
| `BACKUP_DIR` | ダンプ保存先ディレクトリ | `/backups` |
| `BACKUP_RETENTION_DAYS` | ダンプ保持日数 | `7` |
| `BACKUP_AGE_RECIPIENT` | ダンプ暗号化用の[age](https://github.com/FiloSottile/age)公開鍵(`age1...`)。未設定だと起動に失敗する(平文では保存しない) | (必須) |

ダンプは`management_bot-<timestamp>.sql.gz.age`(gzip後にageで公開鍵暗号化)として保存される。サーバーには公開鍵のみを置き、復号に必要な秘密鍵はサーバー外で管理する。

暗号化導入前に作られた`.sql.gz`は平文のままで、保持期間経過後に自動削除される。手動で早めに削除することを推奨する。

## 暗号化鍵の準備

1. ローカルマシンで鍵ペアを生成する。

   ```sh
   age-keygen -o backup-key.txt
   # ageを入れていない場合
   docker run --rm alpine sh -c "apk add -q age && age-keygen"
   ```

2. 秘密鍵(`backup-key.txt`の内容)はサーバーに置かず、パスワードマネージャー等のサーバー外に保管する。紛失するとバックアップを復号できない。
3. 出力された公開鍵(`# public key: age1...`の値)をサーバーの`.env`に`BACKUP_AGE_RECIPIENT`として設定し、`backup`を再起動する。

## リストア手順

1. 対象のダンプファイルを`backup-data`ボリュームまたはホストから取得する。

   ```sh
   docker compose exec backup ls /backups
   docker compose cp backup:/backups/management_bot-<timestamp>.sql.gz.age .
   ```

2. 復元先のPostgresが起動していることを確認する(既存データを上書きする場合は事前に停止・バックアップを取ること)。

3. 秘密鍵のあるローカルマシンで復号・展開してリストアする。

   ```sh
   age -d -i backup-key.txt management_bot-<timestamp>.sql.gz.age | gunzip | docker compose exec -T postgres \
     psql -U management_bot -d management_bot
   ```

   別ホストや素のPostgresへリストアする場合:

   ```sh
   age -d -i backup-key.txt management_bot-<timestamp>.sql.gz.age | gunzip | psql "$DATABASE_URL"
   ```

4. `bot` / `dashboard-api`を再起動し、正常に接続できることを確認する。
