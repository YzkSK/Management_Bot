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

const permissionTargetSchema = z.object({ targetType: z.enum(["user", "role"]), targetId: discordIdSchema });

/** オーナーがDashboardから行う一時VC設定変更の1操作(Discordの制御パネルと同じ操作群)。 */
export const tempVoiceChannelActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("rename"), name: z.string() }),
  z.object({ type: z.literal("userLimit"), value: z.number().int() }),
  z.object({ type: z.literal("bitrate"), kbps: z.number().int() }),
  z.object({ type: z.literal("setLocked"), locked: z.boolean() }),
  z.object({ type: z.literal("setHidden"), hidden: z.boolean() }),
  z.object({ type: z.literal("permit") }).extend(permissionTargetSchema.shape),
  z.object({ type: z.literal("deny") }).extend(permissionTargetSchema.shape),
  z.object({ type: z.literal("removeOverride") }).extend(permissionTargetSchema.shape),
  z.object({ type: z.literal("transferOwner"), userId: discordIdSchema }),
]);
export type TempVoiceChannelAction = z.infer<typeof tempVoiceChannelActionSchema>;

export const tempVoiceChannelActionNotificationSchema = z.object({
  /** bot側の反映結果をRedisで突き合わせるためのID(Dashboardが採番)。 */
  requestId: z.string().uuid(),
  guildId: discordIdSchema,
  channelId: discordIdSchema,
  executorId: discordIdSchema,
  action: tempVoiceChannelActionSchema,
});
export type TempVoiceChannelActionNotification = z.infer<typeof tempVoiceChannelActionNotificationSchema>;

/** Dashboardのオーナー向け設定変更由来のpg_notify('temp_voice_channel_action', ...)を購読する(#649)。 */
export function listenForTempVoiceChannelAction(
  databaseUrl: string,
  onNotify: (notification: TempVoiceChannelActionNotification) => void,
): { ready: Promise<void>; close: () => Promise<void> } {
  return listenForNotification(databaseUrl, "temp_voice_channel_action", (payload) => {
    const result = tempVoiceChannelActionNotificationSchema.safeParse(payload);
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
