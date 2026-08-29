# 新規Discord Bot企画: 実装プラン

## Context

現行の `server-management-bot-v3` はサーバー管理系Discord botのリライトプロジェクトで、ログ機能は実装済みだが、アクティビティモニター・一時VC(旧v2にのみ存在)・スパム対策(前例なし)は未実装。今回はこれらとは**別の新規プロダクト**として、以下4機能を持つマルチテナント対応のDiscord botを新規リポジトリで立ち上げたい、という企画立案の依頼。

v3の設計ドキュメント(`docs/current-state-audit.md`, `docs/rewrite-architecture-design.md`)とコード(`packages/shared/src/capabilities.ts`, `packages/logging/src/**`, `packages/dashboard-access/src/**` 等)を調査し、そのアーキテクチャパターン(4層構成・capabilitiesビットフラグRBAC・DB運用ルール)を踏襲しつつ、技術スタックの一部見直しと「将来の機能追加が容易な設計」を新たな柱として要件定義・設計を行った。本ドキュメントはヒアリング内容と設計案を統合した最終プランであり、次のアクション(新規リポジトリ作成・実装着手)の起点となる。

## ヒアリング結果サマリー

### プロジェクト全体
- **配置**: 完全新規リポジトリ(v3とはコード共有なし、独立プロダクト)
- **運用規模**: マルチテナント(現状は限定公開、将来的な公式公開の可能性を見据えるが、シャーディング等の大規模化対応は今は設計に含めない)
- **プロジェクト名**: `Management_Bot`(仮称)
- **リポジトリ作成先**: 個人アカウント
- **実装優先順位**: 4機能は並行開発したい → 基盤フェーズの完了条件を明確にし、以降は機能ごとに独立着手できる構成にする
- **Git運用**: v3のCLAUDE.mdルール(issue発行必須・ブランチ運用・機能単位の細かいコミット・PRテンプレ・merge commit統一・マージ済みブランチ削除しない)を踏襲しつつ、CIでの自動テスト/lint必須化を新たに追加
- **テスト方針**: v3同様、単体テストのみでなくユースケースを想定した複合テスト(例: 連投→エスカレーション→ログ連携までを通しで検証する等)も実施する。テストファイルは実装ファイルとコロケーション配置(`*.test.ts`)、`bun test`ベース。Dashboard UIを変更した場合は手動での画面動作確認も行う。

### 技術スタック(v3から変更した点)

| 項目 | 選定 | 備考 |
|---|---|---|
| ランタイム | Bun | v3と同じ、ARM64対応済み |
| 言語 | TypeScript strict / ESM | v3と同じ |
| Discordライブラリ | discord.js | v3と同じ |
| スラッシュコマンド実装 | **外部フレームワーク(sapphire系)** | v3は自前ルーターだったが変更 |
| DB / ORM | Postgres + Drizzle | v3と同じ |
| Redis | 利用する | 連投検知カウンター・セッションキャッシュ・リアルタイム配信 |
| Dashboard | **Hono + Vite/React + tRPC** | v3はNext.js+tRPC。認証等を自前実装する前提で軽量構成に変更 |
| 認証 | Discord OAuth2 + **DBセッション** | JWTではなくDB/Redisセッションで即時失効可能に |
| リアルタイム | WebSocket配信(ログ画面) | v3のSocket.io相当をHonoで実装 |
| ホスティング | Oracle Cloud A1 Flex (ARM, 2CPU/12GB) + Docker | 確定 |
| CI/CD | 最初からGitHub Actions整備 | test/lint/typecheck必須化 + Dockerイメージ自動ビルド(ARM64含む) |
| エラー監視(Sentry等) | 後回し | |
| バックアップ | pg_dump定期実行を基盤に含める | |
| i18n | 最初から日英対応、**ギルドごと**に言語設定 | |

### アーキテクチャ・RBAC
- v3の4層構成(`domain→application→discord/router`)とcapabilitiesビットフラグRBACを**完全踏襲**
- 4機能はギルド単位でON/OFF切り替え可能
- DB運用ルール継続: Discord IDは`text`型、タイムスタンプは`timestamptz`、enum型は使わず`text`+`CHECK`制約
- Dashboard UIでのID直接入力禁止、セレクター経由必須のルールも継続

### TypeScriptバージョン方針
- **TypeScript 6.x系(安定版)を採用し、TypeScript 7.0(ネイティブGoコンパイラ/tsgo)の採用は見送る**。2026年8月時点でTS7.0はリリース済みだが、安定したプログラマティックAPIがなく(7.1で導入予定、2026年秋)、`typescript-eslint`はpeer dependencyでTypeScript 6.1未満までしか許可しておらずTS7と組み合わせると`npm install`が失敗する。ts-jest・ts-morphも同様に非対応。
- TS7への移行は、7.1リリースでプログラマティックAPIが安定し`typescript-eslint`等のエコシステムが追いついた段階で改めて検討する(それまでは`tsc`単体をtsgoで高速化する、といった限定的な併用も見送り、構成をシンプルに保つ)。

### Bot権限方針
- Discord Bot招待時に要求する権限は**最小権限**とする。有効化された機能ごとに必要な権限のみ要求する(例: temp-voiceが無効なギルドではチャンネル管理権限を必須にしない)。Bot招待フロー(OAuth2 scope: `bot applications.commands`、初期権限`0`)とDashboard認可フロー(OAuth2 scope: `identify guilds`)は別のものとして扱う。将来機能追加で権限が増える場合はDashboardの再認可導線を用意する。

### 型安全性の方針
- TypeScript strictモード必須(v3同様)に加え、**`any`は原則禁止**。ESLintで`@typescript-eslint/no-explicit-any`をerror設定にし、CIのlintで機械的に検出する。
- 外部境界(Discord APIレスポンス、tRPC入出力、DBの`jsonb`カラム、Redis Pub/Subのペイロード)は必ずzodスキーマでパースし、パース後の推論型を使う。`unknown`で受けて型ガード/zod `.parse()`を通す以外での型アサーション(`as`)は避ける。
- `moderation_thresholds.config`等の`jsonb`カラムは、保存前後で必ずdiscriminated unionのzodスキーマを通し、アプリケーションコード上は`any`/`Record<string, unknown>`のまま扱わない。
- `FeatureModule`・`domain-events.ts`のイベントペイロード・tRPC routerの入出力はすべて明示的な型/zodスキーマを定義し、推論に頼れない箇所(sapphireのpiece拡張時の型引数等)は型定義を書く。
- やむを得ず型が付けにくい外部ライブラリの薄いラッパーを書く場合も、ラッパーの公開シグネチャは具体的な型にし、`any`はラッパー内部に閉じ込めて外に漏らさない。

### 機能別要件
1. **アクティビティモニター**: VC滞在時間・メッセージ数・リアクション数・総合活動スコアを計測。可視化はDashboardのグラフ中心。一時VCの滞在時間も通常VCと区別なく集計に反映(機能間連携)。
2. **ログ機能**: v3の全カテゴリ(メッセージ/メンバー/ロール/チャンネル/ギルド/スレッド/招待/絵文字/AutoMod/インテグレーション/投票/スケジュールイベント/ステージ/監査ログ相関等)を踏襲。出力先はPostgres+Discordチャンネル両方。保持期間はギルドごとに設定し自動アーカイブ/削除。Dashboardはリアルタイム(WebSocket)更新。スパム対策の自動対応履歴もこのログに統合記録。
3. **一時VC機能**: 旧v2完全踏襲(Join to Create方式、専用制御チャンネル+rename/lock/hide/人数制限ボタン、オーナー退出後10分猶予での再割当、手動移譲)。
4. **スパム対策機能**(前例なし・完全新規): 連投/フラッド・招待リンク/宣伝投稿・レイド対策(大量入室検知)・NGワード/メンションスパムを対象。Discord標準AutoModには依存せず完全独自実装。検知時は段階的エスカレーション(警告→削除→タイムアウト→キック/BAN)。強度は**種別ごとに個別設定可能**。信頼ロール/ユーザーを除外するホワイトリスト機能あり。検知イベントはログ機能に連携記録。

### 追加要件: 機能追加を容易にする設計
「機能追加を簡単にできる設計にしてほしい」という要望を受け、以下を設計の柱として組み込んだ(詳細は後述)。
- 新機能追加時に触るファイルを最小限(共通ファイル4〜5箇所の数行追記 + 新規パッケージ1つ)に限定
- 過剰な動的プラグイン機構(ファイルスキャン・dynamic import)は採用せず、型で縛った静的配列への明示登録に留める(CLAUDE.mdの「依頼されていない抽象化をしない」精神を尊重)

---

## アーキテクチャ設計

### monorepo構成

```text
apps/
  bot/            - discord.jsクライアント起動、sapphire登録、機能レジストリ読み込みのみ
  dashboard-api/  - Hono, tRPCサーバー, OAuth, WebSocket
  dashboard-web/  - Vite + React, tRPCクライアント

packages/
  core/               - discord.js薄いラッパー、sapphire base piece、FeatureModule型定義
  db/                 - schema(共通+各機能専用)、migrations、repositories
  shared/             - capabilities, feature-registry, domain-events, log-categories, i18n
  config/             - env validation(zod)
  dashboard-access/   - RBAC解決、セッション認証、tRPC共通ミドルウェア

  activity/           - 機能1: アクティビティモニター(domain/application/discord/router)
  logging/            - 機能2: ログ機能
  temp-voice/         - 機能3: 一時VC
  moderation/         - 機能4: スパム対策
```

依存方向はv3を厳守: `router→application→domain`、`discord→application→domain`。基盤パッケージ(`core/db/shared/config/dashboard-access`)はどの機能パッケージにも依存しない。機能パッケージ同士も相互依存しない(例: activityがtemp-voiceを直接importしない)。

### 拡張性のためのレジストリ機構

過剰設計を避け、**型で縛った静的配列への明示登録**という最小限の機構にする(動的探索はしない: tree-shaking・型安全性・デバッグ容易性を優先)。

- `packages/core/src/feature-module.ts`: `FeatureModule`型(`key`, `registerDiscordHandlers(ctx)`, `router`)を定義。各機能パッケージがこれを実装してexport。
- `packages/shared/src/feature-registry.ts`(DB/discord.js非依存でブラウザからも安全): `FEATURE_KEYS`と`FEATURE_METADATA`(表示名・アイコン・view/manage capability・デフォルトON/OFF)を1箇所で定義。**Dashboardのサイドバーはこのメタデータを読んでループ描画するため、新機能追加時にナビゲーションの編集自体が不要**になる。
- `apps/bot/src/features.ts` / `apps/dashboard-api/src/app-router.ts`: 機能を配列/オブジェクトに1行ずつ明示importして登録するだけの薄い配線点。

### 機能間連携: ドメインイベントバス

「一時VCの滞在時間をアクティビティ集計に反映する」等の連携は、機能パッケージ同士の直接importではなく、`packages/shared/src/domain-events.ts`(zodで型付け)+ Redis Streamsの薄いヘルパー(`packages/core`)経由で疎結合にする。例: temp-voiceが`voice.session.ended`をXADDし、activityがconsumer group経由でXREADGROUPして集計に加算、処理成功後にXACKする。将来第5機能が同じイベントを使いたくなっても既存パッケージは無改修で済む。

- **配送保証**: Pub/Sub(揮発性・購読中のみ配送)ではなくStreams(永続化・XACKまでは再配送可能)を使う。configureされたRedisの永続化設定(AOF/RDB)を前提とし、handler失敗時はXACKせず、次回ポーリングで再配送させる(at-least-once)。
- **冪等性**: `voice_activity_daily`等のロールアップ先テーブルへの加算は、同一イベントの重複配送でも結果が変わらないよう、イベントペイロードに含む一意なイベントID(例: `callSessionId`)をもとに冪等キー付きUPSERT(例: 加算対象行に処理済みイベントIDを記録し二重加算を防ぐ、または対象期間の値を都度再計算する)で実装する。
- **consumer group運用**: consumerは機能(例: `activity`)単位で1つのconsumer group名を持つ。同一機能を複数インスタンスで動かす場合はgroup内の複数consumerとして参加させ、各イベントはgroup内のどれか1つのconsumerにのみ配送される(グループ内での重複処理を避けつつ、機能全体としては全イベントを1回ずつ処理する設計)。ログ配信用WebSocket(全クライアントへのfan-out)とは要件が異なるため区別する。
- **障害復旧**: consumer停止中に溜まったイベントは再起動後のXREADGROUPで取得される。長期停止でストリームが肥大化しないよう、XTRIM等での保持期間設定をPhase 5で検討する。

### capabilitiesビットフラグ(初期セット案)

```ts
VIEW_ACTIVITY, MANAGE_ACTIVITY_SETTINGS,
VIEW_LOGS, VIEW_LOGS_RAW, MANAGE_LOGGING_SETTINGS,
VIEW_TEMP_VOICE, MANAGE_TEMP_VOICE,
VIEW_MODERATION, MANAGE_MODERATION,
MANAGE_ACCESS, MANAGE_GUILD_SETTINGS
```
v3の`capabilities.ts`(`ALL_CAPABILITIES`自動算出、`BASELINE_EVERYONE_CAPABILITIES`、`canGrantCapabilities`昇格防止ロジック)をコードごと踏襲。ビット位置は追記のみ・並べ替え禁止を厳守。`FEATURE_METADATA`の各エントリがどのビットに対応するかを紐付け、新機能追加時は「ビット2つ追記」+「メタデータ1エントリ追記」で完結させる。

### DBスキーマ概要

- **共通テーブル(機能追加で原則不変)**: `guilds`, `guild_configs`(言語等グローバル設定のみ), `dashboard_access_grants`, `sessions`(DBセッション用、新規), `features`(機能マスター、新規), `guild_feature_toggles`(機能ON/OFF、新規)
- **機能ON/OFFの設計判断(CHECK制約を省略しない方式に修正)**: `featureKey`にCHECK制約を直接書く代わりに、`features(key text primary key, defaultEnabled boolean)`という小さなマスターテーブルを設け、`guild_feature_toggles.featureKey`をこのテーブルへの外部キー(`references features(key)`)にする。`features`テーブルの中身は`packages/shared/src/feature-registry.ts`の`FEATURE_METADATA`をソースオブトゥルースとし、**アプリ起動時に自動UPSERTする処理**で同期する(手動INSERTもマイグレーションも不要)。これによりDBレベルの参照整合性(存在しない`featureKey`を弾く)を保ちながら、新機能追加時に`guild_feature_toggles`側のCHECK制約書き換え(ALTER TABLE)が一切発生しない。CLAUDE.mdの「enum禁止・text+CHECK」原則には、外部キーによる正規化という標準的な形で応えている。
- **機能固有の設定・実データ**は各機能が`packages/db/src/schema/<feature>.ts`に専用テーブルを持つ。ログ統合方針により、moderationの検知イベントは専用テーブルを持たず`packages/logging`の`writeLogEvent()`経由で`logs`テーブルに書く。具体的なテーブル案:
  - **activity**: `voice_activity_daily`(guildId, userId, date, secondsInVoice)、`message_activity_daily`(guildId, userId, date, messageCount, reactionCount)、`presence_activity_daily`(guildId, userId, date, onlineSeconds)、`activity_score_daily`(guildId, userId, date, score)。いずれも`(guildId, userId, date)`のunique indexで日次ロールアップし、Dashboardは生イベントでなくこのロールアップを読む。
  - **logging**: `logs`(v3の`logs`テーブル構造をほぼ踏襲: eventName, guildId, actorId, channelId, messageId, eventTimestamp, receivedAt, payload jsonb, archivedAt)、`logging_settings`(guildId, retentionDays, postToChannelId)。
  - **temp_voice**: `temp_voice_configs`(guildId, createChannelId, categoryId)、`temp_voice_channels`(guildId, channelId unique, controlChannelId, ownerId, createdAt, callSessionId)、`temp_voice_ownership_grace`(channelId, previousOwnerId, gracePeriodEndsAt)、`temp_voice_permission_overrides`(channelId, targetId, targetType CHECK(user,role), state CHECK(allow,deny))。
  - **moderation**: `moderation_thresholds`(guildId, violationType CHECK(flood,invite_link,raid,ngword,mention_spam), enabled, config jsonb)、`moderation_escalation_state`(guildId, userId, violationType, strikeCount, lastViolationAt)、`moderation_whitelist`(guildId, targetType CHECK(user,role), targetId)。`config`は種別ごとにshapeが異なるためjsonb+zod discriminated unionで検証する(種別追加時のみ`violationType`のCHECK許容値変更が必要、頻度は低いため許容)。

### バックグラウンドジョブ方式
一時VCの10分猶予期限監視、ログ保持期限切れの自動アーカイブ/削除、pg_dumpバックアップの定期実行など、時間トリガーの処理が複数機能にまたがって必要になる。新規ライブラリ追加の要否も含め、Phase 0で以下のいずれかを選定し明記する:
- **素朴な方式(推奨、まずはこれで開始)**: 各機能が自前で`setInterval`または軽量cronライブラリ(例: `node-cron`)による定期ジョブを持つ。実装が単純で、Bun単一プロセス構成と相性が良い。
- **BullMQ導入**: Redisをジョブキューとしても使う場合の代替案。再試行・分散実行が必要になった場合に検討するが、今回の規模(単一プロセス、小規模)では過剰な可能性が高い。
新規ライブラリ導入が必要になる場合はCLAUDE.mdの「ライブラリ追加は理由を説明して確認を取る」運用ルールに従う。

### Dashboard設計

- Hono(`dashboard-api`) + Vite/React(`dashboard-web`) + tRPC。認証はDiscord OAuth2→トークン暗号化してDB`sessions`テーブルに保存、Cookieにはセッションidのみ。実効capabilities/ロールキャッシュはRedisに短TTLで保持(v3の`resolveEffectiveCapabilities`ロジック踏襲)。
- WebSocketはHonoの`hono/ws`等でアップグレードを扱い、v3の`log-stream.ts`(Redis Stream)をそのまま踏襲してconsumer group pollでpush。
- SSRなしになる影響(初回ロードのちらつき等)は最小限のローディングシェルで吸収し、初期表示データはクライアントサイド`useQuery`取得に統一する。

---

## 実装フェーズ(Issue単位)

### Phase 0: monorepo基盤(直列)
1. リポジトリ初期化(Bun workspaces, turbo.json, tsconfig, lint設定)
2. `packages/config`: env zod schema
3. `packages/db`: 接続クライアント、`schema/core.ts`(guilds/guild_configs/dashboard_access_grants/sessions/features/guild_feature_toggles、featureKeyはfeatures.keyへのFK)、初回マイグレーション、アプリ起動時に`FEATURE_METADATA`を`features`テーブルへUPSERTする処理
4. `packages/shared`: `capabilities.ts`、`feature-registry.ts`(4機能分を先に確定)、`domain-events.ts`、i18n基盤
5. `packages/dashboard-access`: セッション検証、`effective-capabilities.ts`、tRPCミドルウェア(v3から移植可能)
6. `packages/core`: discord.jsラッパー、sapphire組み込み、`FeatureModule`型、Redis pub/subヘルパー
7. `apps/bot`: 空の`FEATURES=[]`、sapphire読み込み設定、bot OAuth
8. `apps/dashboard-api`: 空のapp-router、OAuth2フロー、セッションミドルウェア
9. `apps/dashboard-web`: 認証ガード、`FEATURE_METADATA`駆動の空サイドバーシェル
10. Docker化: `docker-compose.yml`に**postgres・redisコンテナ**(永続化ボリューム付き)+ bot/dashboard-api/dashboard-webの5サービスを定義。各アプリ用`Dockerfile`を作成し、ARM64ビルドを確認
11. GitHub Actions CI(lint/typecheck/test必須化、buildxでARM64含むDockerビルド)
12. pg_dumpバックアップcron
13. Issue/PRテンプレート、新CLAUDE.md整備
14. 新規ギルド参加時のオンボーディング処理: `GuildCreate`イベントで`guilds`レコード作成、`guild_feature_toggles`に4機能分の`defaultEnabled`値を初期投入、ギルドオーナーへの実効capabilities付与(v3の`ensureEveryoneBaselineGrant`相当のロジックを移植)

**Phase 0完了条件(4機能並行着手ゲート)**: capabilities・feature-registry・FeatureModule型・guild_feature_toggles・domain-eventsが確定し、ダミー実装1つでbot/dashboard-apiへの登録がCIで通ることを確認。4機能それぞれの空パッケージ(4層ディレクトリ+ダミーFeatureModule)がレジストリ登録済みでCIが通る状態。

### Phase 1〜4: 4機能(並行)
各機能とも `domain(判定/集計ロジック、単体テスト)→db(schema追加)→application(ユースケース)→discord(ハンドラ、FeatureModule完成)→router(tRPC CRUD)→logging連携→Dashboard UI` の順でIssueを細分化。機能パッケージ同士は非依存のため、担当・レビュー・Issue番号帯を完全に分離して並行進行できる。

### Phase 5: 統合・ハードニング
一時VC↔activityのイベントバス結線、moderation↔logging結線の結合テスト、Redis Stream/WebSocket負荷確認、Oracle Cloud A1実機デプロイ検証。

---

## リスク・注意点

- **ARM64 Docker運用**: Bun/Postgres/Redis公式イメージはマルチアーキ対応済みだが、ネイティブアドオン依存を追加する場合はCIで`linux/arm64`ビルドを必ず検証。
- **sapphire導入時の二重登録機構リスク**: sapphireのpiece loaderと今回のFEATURES配列が併存する。discord層は薄く保ち、実処理はapplication層に集約するルールをsapphire導入後も維持する。
- **Hono+ViteでSSRなし**: 初期データ取得はクライアントサイド`useQuery`に統一。`@hono/trpc-server`アダプタの動作確認をPhase 0で明示的に検証。
- **マルチテナントのスコープ漏れ対策**: 全guild-scoped procedureで`assertGuildScope`相当を強制。Redis Stream/Pub-Subのキー・チャンネル名は必ず`guildId`をprefixに含める。
- **Discord APIレート制限**: 一時VC大量作成・スパム対策の大量タイムアウト実行はレート制限に触れやすいため、application層でバックオフ/キューを検討。
- **シャーディング非対応の影響**: `apps/bot`は単一プロセス前提で設計する。Gatewayイベント量・導入ギルド数が増えた場合のボトルネック対応(discord.jsのシャーディング導入)は今回スコープ外だが、Redis Stream/Pub-Subへの書き込みが単一プロセスに集中する設計になっている点は、将来シャーディングに移行する際に見直しが必要になることをドキュメントに残しておく。

## 新機能追加チェックリスト(第5・第6機能追加時に触る箇所を限定)

1. `packages/shared/src/capabilities.ts` — 末尾にビット2つ追記
2. `packages/shared/src/feature-registry.ts` — キー+メタデータ1レコード追記(アプリ起動時のUPSERT処理により`features`テーブルへも自動反映され、DBマイグレーションは不要)
3. `packages/shared/src/locale/*` — 文言キー追加
4. `packages/db/src/schema/<feature>.ts` — 新規ファイル+`schema/index.ts`に1行+マイグレーション生成
5. `packages/<feature>/` — 既存の一番シンプルな機能パッケージを参考に4層ディレクトリを新規作成、`FeatureModule`実装
6. `apps/bot/src/features.ts` — import+配列に1行
7. `apps/dashboard-api/src/app-router.ts` — import+マージに1行
8. Dashboardナビゲーションは`FEATURE_METADATA`から自動描画のため編集不要

---

## 次のステップ

1. プロジェクト名: `Management_Bot`(仮称)で確定
2. 新規リポジトリ: 個人アカウントに作成
3. Phase 0のIssue発行から実装着手

## 参考にした既存ファイル(パターンの移植元)

- `packages/shared/src/capabilities.ts` — capabilitiesビットフラグの構造
- `packages/dashboard-access/src/{trpc.ts,effective-capabilities.ts}` — RBAC解決・tRPCミドルウェア
- `packages/db/src/schema/core.ts` — 共通スキーマ設計・DB運用ルールの実例
- `packages/logging/src/**`(`discord/*-events.ts`, `log-writer.ts`, `log-retention.ts`) — ログ機能全カテゴリの実装パターン
- `docs/current-state-audit.md` §3.2, §3.3 — 旧v2の一時VC・通話可視化の実装仕様
- `docs/rewrite-architecture-design.md` §3, §5, §6 — 4層構成・Dashboard UI原則・RBAC設計思想
