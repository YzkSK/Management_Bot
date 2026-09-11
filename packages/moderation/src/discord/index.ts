import type { FeatureModuleContext } from "@management-bot/core";
import { Redis } from "ioredis";
import { handleMessageCreate } from "./handle-message-create.js";

export function registerDiscordHandlers(ctx: FeatureModuleContext): void {
  // lazyConnect: メッセージが実際に届くまで接続を開かない(テスト等でのRedis依存を避ける)。
  const redis = new Redis(ctx.redisUrl, { lazyConnect: true });
  ctx.onShutdown(async () => {
    redis.disconnect();
  });

  ctx.client.on("messageCreate", (message) => {
    handleMessageCreate({ db: ctx.db, redis, eventBus: ctx.eventBus }, message).catch((error: unknown) => {
      console.error("moderation: failed to handle messageCreate", error);
    });
  });
}
