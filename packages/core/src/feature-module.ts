import type { Db } from "@management-bot/db";
import type { FeatureKey } from "@management-bot/shared";
import type { AnyTRPCRouter } from "@trpc/server";
import type { BotClient } from "./client.js";
import type { DomainEventBus } from "./domain-events-bus.js";

export interface FeatureModuleContext {
  client: BotClient;
  db: Db;
  /**
   * drizzleプール(db)とは別にLISTEN/NOTIFY用の生接続を張りたい機能向け。
   * dashboard-api(別プロセス)でのDB変更をリアルタイムに検知する用途のみに使うこと
   * (通常のクエリはdbを使う。packages/db listenForLogChannelSettingChanges参照)。
   */
  databaseUrl: string;
  /**
   * DomainEventBus(eventBus)とは別にRedisへ直接アクセスしたい機能向け(例: moderationの
   * 連投検知バッファ)。接続を開いた場合はonShutdownでの解放を忘れないこと。
   */
  redisUrl: string;
  /** 機能間連携用。他機能への直接importではなくdomain-events経由で疎結合にする(CLAUDE.md参照)。 */
  eventBus: DomainEventBus;
  /**
   * registerDiscordHandlers内でcron等の定期実行を登録したい機能向け。
   * 通常のcronアプリ(apps/moderation-decay等)と異なり、Discordクライアントの
   * キャッシュ(VC内メンバー一覧等)やプロセス内メモリ状態に依存する処理はbot本体
   * プロセス内で動かす必要があるため用意する(temp-voiceのオーナー自動再割当#410参照)。
   */
  env: Record<string, string | undefined>;
  /**
   * registerDiscordHandlers内で開いた追加のリソース(databaseUrlでのLISTEN接続等)を
   * bot終了時(SIGTERM/SIGINT)に閉じるためのフック登録。呼ばなかったリソースは
   * プロセスが自然終了しない・接続がリークする原因になるため、db/eventBus以外の
   * 永続接続を開く場合は必ず登録すること。
   */
  onShutdown: (cleanup: () => Promise<void>) => void;
}

/**
 * 各機能パッケージ(activity/logging/temp-voice/moderation等)が実装する統一インターフェース。
 * discord層はここでのみ露出させ、application層はFeatureModule経由でのみdiscord層と接する。
 */
export interface FeatureModule {
  key: FeatureKey;
  /** コマンド・イベントハンドラ等、discord.js/sapphire固有の登録処理をここで行う */
  registerDiscordHandlers: (ctx: FeatureModuleContext) => void | Promise<void>;
  /** dashboard-api側でマウントするtRPCルーター(packages/dashboard-accessのrouterで作成したもの) */
  router: AnyTRPCRouter;
}
