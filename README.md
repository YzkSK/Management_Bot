# Management_Bot

マルチテナント対応のDiscord管理bot。ギルドごとに機能を有効化し、Webダッシュボードから設定する。

## 機能

| パッケージ | 内容 |
| --- | --- |
| `packages/moderation` | モデレーション(違反の累積・エスカレーション) |
| `packages/logging` | ログ |
| `packages/activity` | アクティビティ集計 |
| `packages/temp-voice` | 一時ボイスチャンネル |
| `packages/role-management` | ロール管理 |
| `packages/scheduled-post` | 予約投稿 |

## 構成

Bun + Turborepoのモノレポ。PostgreSQL / Redis(Streamsで機能間イベント連携)を使う。

- `apps/bot` — Discord bot本体
- `apps/dashboard-api` — ダッシュボードAPI(tRPC、Discord OAuth2ログイン)
- `apps/dashboard-web` — ダッシュボードUI(Vite)
- `apps/backup` / `logging-retention` / `moderation-decay` / `activity-rollup` / `session-cleanup` — cronで動く定期ジョブ
- `packages/core` / `db` / `shared` / `config` / `dashboard-access` — 基盤パッケージ

## セットアップ

```sh
bun install
cp .env.example .env   # 値を埋める(各項目の説明はファイル内コメント)
```

### Dockerで起動

```sh
# 開発用(.env.devを読む。Postgres/Redisの認証はcompose内で固定)
docker compose -f docker-compose.dev.yml up -d --build
# 本番用
docker compose up -d --build
```

開発用ではダッシュボードが http://localhost:8080 、APIが http://localhost:3000 で開く。

バックアップの暗号化鍵の準備は [apps/backup/README.md](apps/backup/README.md) を参照。

## 開発

```sh
bun run dev        # 全app起動
bun run lint
bun run typecheck
bun run test
bun run test:integration:local  # 一時PostgreSQLコンテナで結合テスト
```

DB依存テストは`DATABASE_URL`を設定し、マイグレーション適用済みの一時DBに対して実行する。

## ドキュメント

- 開発ルール: [CLAUDE.md](CLAUDE.md)
- 実装プラン: [docs/Management_Bot_実装プラン.md](docs/Management_Bot_実装プラン.md)
