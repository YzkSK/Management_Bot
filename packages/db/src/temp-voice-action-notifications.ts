import { discordIdSchema } from "@management-bot/shared";
import { z } from "zod";
import { listenForNotification } from "./pg-notify.js";

export interface TempVoiceAutoSetupNotification {
  guildId: string;
}
export interface TempVoiceForceDeleteNotification {
  guildId: string;
  channelId: string;
}

const autoSetupSchema = z.object({ guildId: discordIdSchema });
const forceDeleteSchema = z.object({ guildId: discordIdSchema, channelId: discordIdSchema });

/**
 * Dashboard「自動でセットアップ」ボタン由来のpg_notify('temp_voice_auto_setup', ...)を購読する(#415)。
 * moderation-config-notifications.tsとは異なりDBトリガーではなく、tRPC procedure
 * (packages/temp-voice notify-dashboard-actions.ts)が直接発行する。
 */
export function listenForTempVoiceAutoSetup(
  databaseUrl: string,
  onNotify: (notification: TempVoiceAutoSetupNotification) => void,
): { ready: Promise<void>; close: () => Promise<void> } {
  return listenForNotification(databaseUrl, "temp_voice_auto_setup", (payload) => {
    const result = autoSetupSchema.safeParse(payload);
    return result.success ? result.data : null;
  }, onNotify);
}

/** Dashboard「強制削除」ボタン由来のpg_notify('temp_voice_force_delete', ...)を購読する(#415)。 */
export function listenForTempVoiceForceDelete(
  databaseUrl: string,
  onNotify: (notification: TempVoiceForceDeleteNotification) => void,
): { ready: Promise<void>; close: () => Promise<void> } {
  return listenForNotification(databaseUrl, "temp_voice_force_delete", (payload) => {
    const result = forceDeleteSchema.safeParse(payload);
    return result.success ? result.data : null;
  }, onNotify);
}
