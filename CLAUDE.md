# CLAUDE.md

Management_Bot(マルチテナント対応Discord bot)のリポジトリ運用ルール。

## Git運用

- **Issue発行必須**: 作業前に必ずIssueを立てる。IssueなしのPRは作らない。
- **ブランチ運用**: 機能・Issueごとにブランチを切る(例: `issue-14-backup`)。1ブランチ1Issue相当を目安にする。
- **コミット**: 機能単位で細かくコミットする。1コミットに複数の無関係な変更を混ぜない。
- **PR**: `.github/PULL_REQUEST_TEMPLATE.md`を使う。関連Issueを必ずリンクする(`Closes #123`等)。
- **マージ方式**: merge commitに統一する(squash/rebaseは使わない)。
- **マージ済みブランチ**: 削除しない。
- **ライブラリ追加**: 新規に依存を追加する場合は理由を説明し、確認を取ってから追加する。

## CI

- lint/typecheck/testをCI必須化する(`.github/workflows/ci.yml`)。すべて通らないとマージしない。
- DockerビルドはARM64を含めてCIで検証する(Oracle Cloud A1 Flex ARMホスティングのため)。

## テスト方針

- 単体テストに加えて、ユースケースを想定した複合テスト(例: 連投→エスカレーション→ログ連携までを通しで検証)も書く。
- テストファイルは実装ファイルとコロケーション配置(`*.test.ts`)。`bun test`ベース。
- DB依存テストはテスト用PostgreSQLとマイグレーション済みスキーマを前提とする。CI(`.github/workflows/ci.yml`)と同様、ローカルでも`DATABASE_URL`を設定しマイグレーション適用後に実行する。
- Dashboard UIを変更した場合は手動での画面動作確認も行う。

## 型安全性の方針

- TypeScript strictモード必須。**`any`は原則禁止**(`@typescript-eslint/no-explicit-any`をCIのlintでerror検出)。
- 外部境界(Discord APIレスポンス、tRPC入出力、DBの`jsonb`カラム、Redis Streamsのペイロード)は必ず`unknown`として受け、zodの`parse`/`safeParse`で検証してから推論型を使う。検証を代替する型アサーション(`as`)は禁止する。
- `jsonb`カラム(例: `moderation_thresholds.config`)は保存前後で必ずdiscriminated unionのzodスキーマを通し、アプリケーションコード上は`any`/`Record<string, unknown>`のまま扱わない。
- `FeatureModule`・domain-eventsのペイロード・tRPC routerの入出力はすべて明示的な型/zodスキーマを定義する。
- 型が付けにくい外部ライブラリのラッパーを書く場合も内部含め`any`は使わず、`unknown`・ジェネリクス・型ガードで表現する。`eslint-disable`での例外は原則認めず、必要な場合は理由・局所範囲・代替案をPRで説明する。

## Bot権限方針

- Discord Bot招待時に要求する権限は**最小権限**とする。有効化された機能ごとに必要な権限のみ要求する(例: temp-voiceが無効なギルドではチャンネル管理権限を必須にしない)。
- Bot招待フロー(OAuth2 scope: `bot applications.commands`、初期権限`0`)とDashboard認可フロー(OAuth2 scope: `identify guilds`)は別のものとして扱う。混同しない。
- 将来機能追加で権限が増える場合は、要求理由・影響範囲を明示してDashboardの再認可導線を用意する。`buildInviteUrl`(`apps/bot/src/invite-url.ts`)は必要な権限ビットフィールドを引数で受け取れるため、再認可時はこれを使って必要権限のみを含むURLを生成する(初回招待時は無権限のままデフォルト呼び出し)。

## アーキテクチャ

- 4層構成(`discord`/`router`(入口層) → `application` → `domain` → `db`)を厳守: `router→application→domain`、`discord→application→domain`。`discord`と`router`はどちらも入口層で、機能によって一方または両方を持つ。
- 基盤パッケージ(`core/db/shared/config/dashboard-access`)は機能パッケージに依存しない。機能パッケージ同士も相互依存しない。
- 機能間連携は直接importではなく`packages/shared/src/domain-events.ts` + Redis Streams(consumer group、at-least-once配送、イベントID等による冪等処理)経由で疎結合にする。
- 拡張は型で縛った静的配列への明示登録に留める。過剰な動的プラグイン機構(ファイルスキャン・dynamic import)は採用しない(依頼されていない抽象化をしない)。

## DB運用ルール

- Discord IDは`text`型、タイムスタンプは`timestamptz`。
- enum型は使わず、`text` + 外部キー(マスターテーブル参照)または`CHECK`制約で表現する。
- Dashboard UIでのID直接入力は禁止。セレクター経由必須。

詳細は [docs/Management_Bot_実装プラン.md](docs/Management_Bot_実装プラン.md) を参照。
