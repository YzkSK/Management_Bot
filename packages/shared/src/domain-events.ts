import { z } from "zod";
import { MODERATION_ACTION_TYPES } from "./moderation-action-type.js";
import { moderationIncidentSchema } from "./moderation-incident.js";

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

const moderationActionBaseFields = {
  type: z.literal("moderation.action.recorded"),
  guildId: z.string(),
  caseId: z.string(),
  targetUserId: z.string(),
  moderatorId: z.string(),
  actionType: z.enum(MODERATION_ACTION_TYPES),
  /** actionType==="timeout"の場合のみ設定するタイムアウト時間(分)。5→10→30分と多段階化する(#322)。 */
  timeoutMinutes: z.number().int().positive().optional(),
  incident: moderationIncidentSchema,
  createdAt: z.iso.datetime(),
};

/**
 * action="create"は処罰予定の記録(strike加算・エスカレーション段階決定の時点で発行)、
 * action="resolve"はDiscord API実行後の結果確定を表す(#350)。同一caseIdで2段階発行される。
 * resolveのみresult/failureCodeを必須にし、Bot権限不足・対象ユーザー退出等による
 * 処罰実行失敗をログ側で判別できるようにする。result="skipped"は、raid一括timeoutと
 * 同一ユーザーの複数検知でより重い処罰に集約され、実行されなかった側を表す
 * (未解決のcreateのまま残さないため)。
 */
export const moderationActionRecordedSchema = z.discriminatedUnion("action", [
  z.object({ ...moderationActionBaseFields, action: z.literal("create") }),
  z.object({
    ...moderationActionBaseFields,
    action: z.literal("resolve"),
    result: z.enum(["success", "failed", "skipped"]),
    failureCode: z.string().optional(),
  }),
]);

export type ModerationActionRecordedEvent = z.infer<typeof moderationActionRecordedSchema>;

const tempVoiceEventBaseFields = {
  type: z.literal("temp-voice.event.recorded"),
  guildId: z.string(),
  /** ログ相関キーを兼ねる(#406参照、専用UUIDは発行しない)。 */
  channelId: z.string(),
  createdAt: z.iso.datetime(),
  /** システム起因(自動削除・自動再割当)の場合は未設定。 */
  executorId: z.string().optional(),
  executorName: z.string().optional(),
};

/**
 * 当初locked/unlocked/hidden/unhidden、memberAllowed/memberDeniedを個別action定義していたが、
 * いずれも「permission overwriteを切り替える」同一操作のため、permissionChanged(@everyone向け)と
 * memberPermissionChanged(個別メンバー/ロール向け、state="cleared"はメンバー管理からの解除)に統合した(#413)。
 * createはオーナー自身の入室操作が起点のためexecutorIdを持たせずownerIdで表す。
 * ownerTransferredはtrigger="manual"のときのみexecutorId=previousOwnerIdを設定する。
 */
export const tempVoiceEventRecordedSchema = z.discriminatedUnion("action", [
  z.object({
    ...tempVoiceEventBaseFields,
    action: z.literal("created"),
    ownerId: z.string(),
    ownerName: z.string().optional(),
    controlChannelId: z.string(),
  }),
  z.object({
    ...tempVoiceEventBaseFields,
    action: z.literal("deleted"),
    ownerId: z.string(),
    ownerName: z.string().optional(),
  }),
  z.object({
    ...tempVoiceEventBaseFields,
    action: z.literal("renamed"),
    before: z.string(),
    after: z.string(),
  }),
  z.object({
    ...tempVoiceEventBaseFields,
    action: z.literal("permissionChanged"),
    permission: z.enum(["connect", "view"]),
    allowed: z.boolean(),
  }),
  z.object({
    ...tempVoiceEventBaseFields,
    action: z.literal("userLimitChanged"),
    before: z.number().int(),
    after: z.number().int(),
  }),
  z.object({
    ...tempVoiceEventBaseFields,
    action: z.literal("bitrateChanged"),
    before: z.number().int(),
    after: z.number().int(),
  }),
  z.object({
    ...tempVoiceEventBaseFields,
    action: z.literal("ownerTransferred"),
    previousOwnerId: z.string(),
    previousOwnerName: z.string().optional(),
    newOwnerId: z.string(),
    newOwnerName: z.string().optional(),
    trigger: z.enum(["manual", "autoGraceExpired"]),
  }),
  z.object({
    ...tempVoiceEventBaseFields,
    action: z.literal("memberPermissionChanged"),
    state: z.enum(["allow", "deny", "cleared"]),
    targetType: z.enum(["user", "role"]),
    targetId: z.string(),
    targetName: z.string().optional(),
  }),
]);

export type TempVoiceEventRecordedEvent = z.infer<typeof tempVoiceEventRecordedSchema>;

export const DOMAIN_EVENT_SCHEMAS = {
  "voice.session.ended": voiceSessionEndedSchema,
  "moderation.action.recorded": moderationActionRecordedSchema,
  "temp-voice.event.recorded": tempVoiceEventRecordedSchema,
} as const;

export type DomainEventType = keyof typeof DOMAIN_EVENT_SCHEMAS;

export type DomainEvent = z.infer<(typeof DOMAIN_EVENT_SCHEMAS)[DomainEventType]>;
