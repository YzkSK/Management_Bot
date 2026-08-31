import { z } from "zod";
import { MODERATION_ACTION_TYPES } from "./moderation-action-type.js";

/**
 * 機能パッケージ間の連携はRedis Pub/Sub経由のイベントで疎結合にする(直接import禁止)。
 * 新イベント追加時はここにschemaを1件追記し、`DOMAIN_EVENT_SCHEMAS`に登録する。
 */
export const voiceSessionEndedSchema = z
  .object({
    type: z.literal("voice.session.ended"),
    guildId: z.string(),
    userId: z.string(),
    channelId: z.string(),
    startedAt: z.iso.datetime(),
    endedAt: z.iso.datetime(),
    durationSeconds: z.number().int().nonnegative(),
  })
  .refine((event) => Date.parse(event.endedAt) >= Date.parse(event.startedAt), {
    message: "endedAt must not precede startedAt",
    path: ["endedAt"],
  });

export type VoiceSessionEndedEvent = z.infer<typeof voiceSessionEndedSchema>;

export const moderationActionRecordedSchema = z.object({
  type: z.literal("moderation.action.recorded"),
  guildId: z.string(),
  caseId: z.string(),
  targetUserId: z.string(),
  moderatorId: z.string(),
  action: z.enum(["create", "update", "resolve"]),
  actionType: z.enum(MODERATION_ACTION_TYPES),
  createdAt: z.iso.datetime(),
});

export type ModerationActionRecordedEvent = z.infer<typeof moderationActionRecordedSchema>;

export const DOMAIN_EVENT_SCHEMAS = {
  "voice.session.ended": voiceSessionEndedSchema,
  "moderation.action.recorded": moderationActionRecordedSchema,
} as const;

export type DomainEventType = keyof typeof DOMAIN_EVENT_SCHEMAS;

export type DomainEvent = z.infer<(typeof DOMAIN_EVENT_SCHEMAS)[DomainEventType]>;
