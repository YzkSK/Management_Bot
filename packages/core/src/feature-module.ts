import type { FeatureKey } from "@management-bot/shared";
import type { AnyTRPCRouter } from "@trpc/server";
import type { BotClient } from "./client.js";

export interface FeatureModuleContext {
  client: BotClient;
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
