import type { FeatureModuleContext } from "@management-bot/core";
import { Redis } from "ioredis";
import { createModerationConfigCache } from "../application/index.js";
import { handleGuildMemberAddEvent } from "./handle-guild-member-add.js";
import { handleMessageCreate } from "./handle-message-create.js";

/** 無効なコード・Discord API障害等、解決に失敗した場合はnullを返す(呼び出し側で安全側=検知扱いに倒す)。 */
async function resolveInviteGuildId(client: FeatureModuleContext["client"], code: string): Promise<string | null> {
  try {
    const invite = await client.fetchInvite(code);
    return invite.guild?.id ?? null;
  } catch {
    return null;
  }
}

export function registerDiscordHandlers(ctx: FeatureModuleContext): void {
  // lazyConnect: メッセージが実際に届くまで接続を開かない(テスト等でのRedis依存を避ける)。
  const redis = new Redis(ctx.redisUrl, { lazyConnect: true });
  ctx.onShutdown(async () => {
    redis.disconnect();
  });

  // whitelist/thresholds/ngwordsをguild単位でまとめてTTLキャッシュする(#352)。
  // プロセス起動時に1回生成し、messageCreate/guildMemberAdd両ハンドラで共有する。
  const configCache = createModerationConfigCache();

  // messageCreateのみ購読する。メッセージ編集で後から招待リンク/NGワードが追加された場合の
  // 検知はスコープ外(Issue #188)。対象にする場合はmessageUpdateハンドラの追加検討が必要。
  ctx.client.on("messageCreate", (message) => {
    handleMessageCreate(
      {
        db: ctx.db,
        redis,
        eventBus: ctx.eventBus,
        resolveInviteGuildId: (code) => resolveInviteGuildId(ctx.client, code),
        configCache,
      },
      message,
    ).catch((error: unknown) => {
      console.error("moderation: failed to handle messageCreate", error);
    });
  });

  // guildMemberAddはmessageCreateとは別のギルド単位集団現象(レイド)・入室時単体判定
  // (new_account_guard)を扱うため、専用ハンドラとして分離登録する(設計spec参照)。
  ctx.client.on("guildMemberAdd", (member) => {
    handleGuildMemberAddEvent({ db: ctx.db, redis, eventBus: ctx.eventBus, configCache }, member).catch((error: unknown) => {
      console.error("moderation: failed to handle guildMemberAdd", error);
    });
  });
}
