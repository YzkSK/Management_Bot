import type { FeatureModuleContext } from "@management-bot/core";
import { listenForModerationConfigChanges } from "@management-bot/db";
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
  // dashboard-api(別プロセス)での設定変更をTTL満了前に反映するため、
  // DBトリガー(migrations/0020)のpg_notifyをLISTENしてキャッシュを即時invalidateする(#353)。
  // 購読自体の失敗はログ出力のみに留め、TTL経由の最終的な反映(デフォルト5秒)に
  // フォールバックさせる(bot起動をブロックしない、logging側のcreateChannelSettingResolverと同じ設計)。
  const configChangeNotifications = listenForModerationConfigChanges(ctx.databaseUrl, ({ guildId }) => {
    configCache.invalidate(guildId);
  });
  configChangeNotifications.ready.catch((error: unknown) => {
    console.error("Failed to listen for moderation_config_changed (cache invalidation disabled)", error);
  });
  ctx.onShutdown(configChangeNotifications.close);

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
