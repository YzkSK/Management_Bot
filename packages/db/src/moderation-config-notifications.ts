import { discordIdSchema } from "@management-bot/shared";
import { z } from "zod";
import { listenForNotification } from "./pg-notify.js";

export interface ModerationConfigChangedNotification {
  guildId: string;
}

const notificationSchema = z.object({ guildId: discordIdSchema });

/**
 * moderation_thresholds/moderation_whitelist/moderation_ngwordsの変更(INSERT/UPDATE/DELETE)時に
 * DBトリガー(migrations/0020)が発行するpg_notify('moderation_config_changed', ...)を購読する。
 * bot側の短命TTLキャッシュ(packages/moderation moderation-config-cache.ts)をTTL満了前に
 * 即時invalidateするために使う(#353)。
 */
export function listenForModerationConfigChanges(
  databaseUrl: string,
  onChange: (notification: ModerationConfigChangedNotification) => void,
): { ready: Promise<void>; close: () => Promise<void> } {
  return listenForNotification(databaseUrl, "moderation_config_changed", (payload) => {
    const result = notificationSchema.safeParse(payload);
    return result.success ? result.data : null;
  }, onChange);
}
