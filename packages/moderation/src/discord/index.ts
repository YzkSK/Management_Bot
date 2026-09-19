import type { FeatureModuleContext } from "@management-bot/core";
import { listenForModerationConfigChanges } from "@management-bot/db";
import { createTtlCache } from "@management-bot/shared";
import { Redis } from "ioredis";
import { createModerationConfigCache, listLockdownsNeedingSynchronization } from "../application/index.js";
import { handleGuildMemberAddEvent } from "./handle-guild-member-add.js";
import { synchronizeLockdown } from "./lockdown.js";
import { handleMessageCreate } from "./handle-message-create.js";
import { handleMessageUpdate } from "./handle-message-update.js";

/** 招待コードはグローバルに一意なためguild非依存でキャッシュ可能。TTLはmoderation-config-cacheと同じ5秒(#362)。 */
const INVITE_RESOLUTION_TTL_MS = 5_000;

/**
 * 同一招待コードが短時間に連投された場合のfetchInvite重複呼び出しを防ぐ(改善案5.5節)。
 * 解決失敗はキャッシュしない(一時的なAPI障害でしばらく誤検知し続けるのを避けるため)。
 */
export function createInviteGuildIdResolver(
  client: FeatureModuleContext["client"],
): (code: string) => Promise<string | null> {
  // rejectしたPromiseをキャッシュに渡すことでTTL満了を待たずエントリが破棄される
  // (createTtlCacheの仕様)。ここでtry/catchしてnullに変換すると「成功」扱いになり
  // 失敗までTTL分キャッシュされてしまうため、nullへの変換は呼び出し側で行う
  // (guild.idが取得できないケースもthrowしてreject扱いに揃える。Codexレビュー指摘)。
  const cache = createTtlCache<string>(INVITE_RESOLUTION_TTL_MS);
  return (code) =>
    cache(code, async () => {
      const invite = await client.fetchInvite(code);
      if (invite.guild?.id === undefined) {
        throw new Error(`invite ${code} has no guild`);
      }
      return invite.guild.id;
    }).catch(() => null);
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
  const resolveInviteGuildId = createInviteGuildIdResolver(ctx.client);
  // dashboard-api(別プロセス)での設定変更をTTL満了前に反映するため、
  // DBトリガー(migrations/0020)のpg_notifyをLISTENしてキャッシュを即時invalidateする(#353)。
  // 購読自体の失敗はログ出力のみに留め、TTL経由の最終的な反映(デフォルト5秒)に
  // フォールバックさせる(bot起動をブロックしない、logging側のcreateChannelSettingResolverと同じ設計)。
  const configChangeNotifications = listenForModerationConfigChanges(ctx.databaseUrl, ({ guildId }) => {
    configCache.invalidate(guildId);
    const guild = ctx.client.guilds.cache.get(guildId);
    if (guild) {
      synchronizeLockdown(ctx.db, guild).catch((error: unknown) => {
        console.error(`moderation: failed to synchronize lockdown for guild ${guildId}`, error);
      });
    }
  });
  configChangeNotifications.ready.catch((error: unknown) => {
    console.error("Failed to listen for moderation_config_changed (cache invalidation disabled)", error);
  });
  ctx.onShutdown(configChangeNotifications.close);

  const synchronizePendingLockdowns = () => {
    listLockdownsNeedingSynchronization(ctx.db)
      .then((guildIds) =>
        Promise.all(
          guildIds.map(async (guildId) => {
            const guild = ctx.client.guilds.cache.get(guildId);
            if (guild) await synchronizeLockdown(ctx.db, guild);
          }),
        ),
      )
      .catch((error: unknown) => {
        console.error("moderation: failed to synchronize pending lockdowns", error);
      });
  };
  if (ctx.client.isReady()) synchronizePendingLockdowns();
  else ctx.client.once("ready", synchronizePendingLockdowns);

  const detectAndEscalateDeps = {
    db: ctx.db,
    redis,
    eventBus: ctx.eventBus,
    resolveInviteGuildId,
    configCache,
  };

  ctx.client.on("messageCreate", (message) => {
    handleMessageCreate(detectAndEscalateDeps, message).catch((error: unknown) => {
      console.error("moderation: failed to handle messageCreate", error);
    });
  });

  // 投稿後の編集でNGワード・招待リンクを後から仕込む回避を防ぐ(改善案7.1節、Issue #188)。
  // flood/duplicate_content/mention_spamはバッファ・累積状態に依存するため編集時は再検知しない
  // (detectAndEscalateOnEditのコメント参照)。
  ctx.client.on("messageUpdate", (_oldMessage, newMessage) => {
    handleMessageUpdate(detectAndEscalateDeps, newMessage).catch((error: unknown) => {
      console.error("moderation: failed to handle messageUpdate", error);
    });
  });

  // guildMemberAddはmessageCreateとは別のギルド単位集団現象であるレイドを扱う。
  ctx.client.on("guildMemberAdd", (member) => {
    handleGuildMemberAddEvent({ db: ctx.db, redis, eventBus: ctx.eventBus, configCache }, member).catch((error: unknown) => {
      console.error("moderation: failed to handle guildMemberAdd", error);
    });
  });
}
