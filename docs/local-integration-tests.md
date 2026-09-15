# ローカル結合テスト

```sh
docker compose -f docker-compose.dev.yml up -d postgres redis
bun run test:integration:local
```

テスト実行スクリプトは開発用Postgres・Redisの接続先、Dashboardの`VITE_API_URL`を明示し、マイグレーション後に逐次テストを実行する。
