import type { Db } from "@management-bot/db";
import type { FeatureKey } from "@management-bot/shared";
import type { AnyTRPCRouter } from "@trpc/server";
import type { BotClient } from "./client.js";
import type { DomainEventBus } from "./domain-events-bus.js";

export interface FeatureModuleContext {
  client: BotClient;
  db: Db;
  /** 機能間連携用。他機能への直接importではなくdomain-events経由で疎結合にする(CLAUDE.md参照)。 */
  eventBus: DomainEventBus;
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
