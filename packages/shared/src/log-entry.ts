import { z } from "zod";
import { LOG_CATEGORIES } from "./log-category.js";
import { MODERATION_ACTION_TYPES } from "./moderation-action-type.js";

const nonEmptyString = z.string().min(1);

const base = {
  guildId: nonEmptyString,
  createdAt: z.iso.datetime(),
  /**
   * 監査ログ相関(#52)で事後的に埋める実行者。discord.jsのgatewayイベント単体では
   * 実行者を取得できないカテゴリが大半のため、初回書き込み時は未設定(undefined)が正常系。
   */
  executorId: nonEmptyString.optional(),
  /** executorIdが判明した時点(監査ログ相関時)のDiscord表示名のスナップショット。executorId未設定なら常に未設定。 */
  executorName: nonEmptyString.optional(),
  /**
   * イベントの主体(message.authorId/reaction.userId/member.userId等)がBotアカウントかどうか。
   * 監査ログ相関と同様、ダッシュボードのデフォルト表示から隔離するためのフラグ。
   * 主体を持たないカテゴリ(role/channel/guild等)や、判定情報を持たないハンドラでは未設定のまま。
   */
  actorIsBot: z.boolean().optional(),
};

export const messageLogEntrySchema = z.object({
  ...base,
  category: z.literal("message"),
  channelId: nonEmptyString,
  authorId: nonEmptyString,
  /** イベント発生時点のDiscord表示名のスナップショット(executorName/threadNameと同じパターン)。 */
  authorName: nonEmptyString.optional(),
  action: z.enum(["create", "update", "delete", "bulkDelete", "pin", "unpin"]),
  content: z.string().optional(),
  /** action=updateのみ設定する編集前本文。移行前に記録された既存updateエントリには存在しないため未設定を許容する。 */
  previousContent: z.string().optional().meta({ sensitive: true }),
  /** action=pin/unpinで対象メッセージを特定するために設定する。create/update/delete/bulkDeleteでは設定しない。 */
  messageId: nonEmptyString.optional(),
});

export const reactionLogEntrySchema = z.object({
  ...base,
  category: z.literal("reaction"),
  channelId: nonEmptyString,
  messageId: nonEmptyString,
  userId: nonEmptyString,
  /** イベント発生時点のDiscord表示名のスナップショット。partial(未キャッシュ)userの場合は未設定。 */
  userName: nonEmptyString.optional(),
  emoji: nonEmptyString,
  action: z.enum(["add", "remove"]),
});

export const memberLogEntrySchema = z.object({
  ...base,
  category: z.literal("member"),
  userId: nonEmptyString,
  /** イベント発生時点のDiscord表示名のスナップショット。ban/unbanはGuildMemberを取得できないためニックネーム抜き。 */
  userName: nonEmptyString.optional(),
  action: z.enum(["join", "leave", "ban", "unban", "kick", "timeout", "timeoutRemove", "nicknameChange"]),
  /** nicknameChange時点の変更前表示名。変更前ニックネームが未設定の自己変更見出しに使う。 */
  previousUserName: nonEmptyString.optional(),
  changes: z
    .object({
      nickname: z.object({ before: z.string().nullable(), after: z.string().nullable() }),
    })
    .optional(),
});

export const roleLogEntrySchema = z.object({
  ...base,
  category: z.literal("role"),
  roleId: nonEmptyString,
  action: z.enum(["create", "update", "delete", "memberAdd", "memberRemove"]),
  /** action=memberAdd/memberRemoveの対象メンバー。create/update/delete(ロール自体の変更)では設定しない。 */
  userId: nonEmptyString.optional(),
  /** イベント発生時点のDiscord表示名のスナップショット。userIdと同様action=memberAdd/memberRemoveのみ設定する。 */
  userName: nonEmptyString.optional(),
  /** action=updateのみ設定する変更フィールドごとのbefore/after。差分なしのupdateは書き込み自体を行わないため、空オブジェクトは許容しない。 */
  changes: z
    .record(z.string(), z.object({ before: z.union([z.string(), z.number(), z.boolean()]), after: z.union([z.string(), z.number(), z.boolean()]) }))
    .refine((changes) => Object.keys(changes).length > 0, { message: "changes must not be empty" })
    .optional()
    .meta({ sensitive: true }),
});

const channelChangeValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const channelLogEntrySchema = z.object({
  ...base,
  category: z.literal("channel"),
  channelId: nonEmptyString,
  action: z.enum(["create", "update", "delete"]),
  /** action=updateのみ設定する変更フィールドごとのbefore/after。topicはnull(未設定)を取り得るため許容する。差分なしのupdateは書き込み自体を行わないため、空オブジェクトは許容しない。 */
  changes: z
    .record(z.string(), z.object({ before: channelChangeValue, after: channelChangeValue }))
    .refine((changes) => Object.keys(changes).length > 0, { message: "changes must not be empty" })
    .optional()
    .meta({ sensitive: true }),
});

export const guildLogEntrySchema = z.object({
  ...base,
  category: z.literal("guild"),
  action: z.enum(["update"]),
  /** action=updateのみ設定する変更フィールドごとのbefore/after。icon/afkChannelIdはnull(未設定)を取り得るため許容する。差分なしのupdateは書き込み自体を行わないため、空オブジェクトは許容しない。 */
  changes: z
    .record(z.string(), z.object({ before: channelChangeValue, after: channelChangeValue }))
    .refine((changes) => Object.keys(changes).length > 0, { message: "changes must not be empty" })
    .optional()
    .meta({ sensitive: true }),
});

export const threadLogEntrySchema = z.object({
  ...base,
  category: z.literal("thread"),
  threadId: nonEmptyString,
  channelId: nonEmptyString,
  action: z.enum(["create", "update", "delete", "archive", "unarchive", "memberAdd", "memberRemove"]),
  /** action=memberAdd/memberRemoveの対象メンバー。それ以外(スレッド自体の変更)では設定しない。 */
  userId: nonEmptyString.optional(),
  /** イベント発生時点のDiscord表示名のスナップショット。guildMemberが未キャッシュの場合は未設定。 */
  userName: nonEmptyString.optional(),
  /** 通常はaction=createのみ設定する、フォーラム/メディア投稿のスターターメッセージ本文。 */
  content: z.string().optional(),
  /**
   * イベント発生時点のスレッド名のスナップショット。Discord REST APIのアクティブスレッド一覧は
   * アーカイブ・削除済みスレッドを含まないため、表示名解決をAPI頼みにせずログ側に保持する。
   */
  threadName: nonEmptyString.optional(),
});

export const inviteLogEntrySchema = z.object({
  ...base,
  category: z.literal("invite"),
  code: nonEmptyString,
  channelId: nonEmptyString,
  action: z.enum(["create", "delete"]),
});

export const emojiLogEntrySchema = z.object({
  ...base,
  category: z.literal("emoji"),
  emojiId: nonEmptyString,
  action: z.enum(["create", "update", "delete"]),
});

export const stickerLogEntrySchema = z.object({
  ...base,
  category: z.literal("sticker"),
  stickerId: nonEmptyString,
  action: z.enum(["create", "update", "delete"]),
});

export const autoModLogEntrySchema = z.object({
  ...base,
  category: z.literal("autoMod"),
  ruleId: nonEmptyString,
  userId: nonEmptyString,
  /** イベント発生時点のDiscord表示名のスナップショット。guild.members.cacheに存在する場合のみ設定する。 */
  userName: nonEmptyString.optional(),
  channelId: nonEmptyString.optional(),
  action: z.enum(["ruleCreate", "ruleUpdate", "ruleDelete", "actionExecuted"]),
});

export const integrationLogEntrySchema = z.object({
  ...base,
  category: z.literal("integration"),
  integrationId: nonEmptyString,
  action: z.enum(["create", "update", "delete"]),
});

export const pollLogEntrySchema = z.object({
  ...base,
  category: z.literal("poll"),
  messageId: nonEmptyString,
  channelId: nonEmptyString,
  action: z.enum(["create", "end"]),
});

export const scheduledEventLogEntrySchema = z.object({
  ...base,
  category: z.literal("scheduledEvent"),
  eventId: nonEmptyString,
  action: z.enum(["create", "update", "delete", "start", "complete", "cancel"]),
});

export const stageLogEntrySchema = z.object({
  ...base,
  category: z.literal("stage"),
  stageInstanceId: nonEmptyString,
  channelId: nonEmptyString,
  action: z.enum(["start", "update", "end"]),
});

export const auditLogCorrelationEntrySchema = z.object({
  ...base,
  category: z.literal("auditLogCorrelation"),
  auditLogEntryId: nonEmptyString,
  targetId: nonEmptyString.optional(),
  actionType: nonEmptyString,
});

export const moderationCaseLogEntrySchema = z.object({
  ...base,
  category: z.literal("moderationCase"),
  caseId: nonEmptyString,
  targetUserId: nonEmptyString,
  moderatorId: nonEmptyString,
  action: z.enum(["create", "update", "resolve"]),
  actionType: z.enum(MODERATION_ACTION_TYPES),
});

const voiceBase = {
  ...base,
  category: z.literal("voice"),
  userId: nonEmptyString,
  /** イベント発生時点のDiscord表示名のスナップショット。leave(VoiceState.memberが取得できない)では未設定。 */
  userName: nonEmptyString.optional(),
  /** join: 入室先、leave: 退室元、move: 移動先のチャンネルID。 */
  channelId: nonEmptyString,
};

/** voice: action=updateのchangesキー。discord.jsのVoiceStateのフラグ名と一致させる。 */
export const VOICE_STATE_FLAG_NAMES = ["selfMute", "selfDeaf", "serverMute", "serverDeaf", "streaming"] as const;
export type VoiceStateFlagName = (typeof VOICE_STATE_FLAG_NAMES)[number];

const voiceStateFlag = z.object({ before: z.boolean(), after: z.boolean() });

/** previousChannelId(移動元)はaction=moveの場合のみ必須にする(join/leaveでは持たせない)。 */
export const voiceLogEntrySchema = z.discriminatedUnion("action", [
  z.object({ ...voiceBase, action: z.literal("join") }),
  z.object({ ...voiceBase, action: z.literal("leave") }),
  z.object({ ...voiceBase, action: z.literal("move"), previousChannelId: nonEmptyString }),
  z.object({
    ...voiceBase,
    action: z.literal("update"),
    /** VOICE_STATE_FLAG_NAMESのうち変化したフラグのみ設定する。差分なしは書き込み自体を行わないため、空オブジェクトは許容しない。 */
    changes: z
      .partialRecord(z.enum(VOICE_STATE_FLAG_NAMES), voiceStateFlag)
      .refine((changes) => Object.keys(changes).length > 0, { message: "changes must not be empty" }),
  }),
]);

export const LOG_ENTRY_SCHEMAS = {
  message: messageLogEntrySchema,
  reaction: reactionLogEntrySchema,
  member: memberLogEntrySchema,
  role: roleLogEntrySchema,
  channel: channelLogEntrySchema,
  guild: guildLogEntrySchema,
  thread: threadLogEntrySchema,
  invite: inviteLogEntrySchema,
  emoji: emojiLogEntrySchema,
  sticker: stickerLogEntrySchema,
  autoMod: autoModLogEntrySchema,
  integration: integrationLogEntrySchema,
  poll: pollLogEntrySchema,
  scheduledEvent: scheduledEventLogEntrySchema,
  stage: stageLogEntrySchema,
  auditLogCorrelation: auditLogCorrelationEntrySchema,
  moderationCase: moderationCaseLogEntrySchema,
  voice: voiceLogEntrySchema,
} as const;

export type LogCategory = keyof typeof LOG_ENTRY_SCHEMAS;

// LOG_ENTRY_SCHEMASのキー集合とLOG_CATEGORIES(shared、DBのCHECK制約が参照する)が一致することを型レベルで強制する。
type AssertExact<T extends readonly LogCategory[]> = LogCategory extends T[number] ? T : never;
const _categoriesMatchShared: AssertExact<typeof LOG_CATEGORIES> = LOG_CATEGORIES;
void _categoriesMatchShared;

const logEntrySchemaOptions = Object.values(LOG_ENTRY_SCHEMAS) as [
  (typeof LOG_ENTRY_SCHEMAS)[LogCategory],
  ...(typeof LOG_ENTRY_SCHEMAS)[LogCategory][],
];

export const logEntrySchema = z.discriminatedUnion("category", logEntrySchemaOptions);

export type LogEntry = z.infer<typeof logEntrySchema>;

export function parseLogEntry(input: unknown): LogEntry {
  return logEntrySchema.parse(input);
}

export function safeParseLogEntry(input: unknown): z.ZodSafeParseResult<LogEntry> {
  return logEntrySchema.safeParse(input);
}

/**
 * カテゴリごとの「VIEW_LOGS_RAWなしでマスクすべきフィールド名」をzodスキーマの
 * `.meta({ sensitive: true })`から導出する。手動列挙テーブルとLogEntryスキーマが
 * 独立して二重管理になっており、フィールド追加時にマスク対象への追記漏れが起きていたため
 * (issue #219)、スキーマ自体を単一の情報源にする。
 * voiceのようなdiscriminatedUnionスキーマは各選択肢(action別)のshapeを合成して調べる。
 */
function collectSensitiveFields(schema: z.ZodTypeAny): readonly string[] {
  const options: z.ZodTypeAny[] =
    "options" in schema.def && Array.isArray((schema.def as { options?: unknown }).options)
      ? ((schema.def as { options: z.ZodTypeAny[] }).options)
      : [schema];

  const fields = new Set<string>();
  for (const option of options) {
    const shape = (option as { shape?: Record<string, z.ZodTypeAny> }).shape;
    if (!shape) continue;
    for (const [key, field] of Object.entries(shape)) {
      if ((field.meta() as { sensitive?: boolean } | undefined)?.sensitive) fields.add(key);
    }
  }
  return [...fields];
}

export const SENSITIVE_LOG_FIELDS: Record<LogCategory, readonly string[]> = Object.fromEntries(
  Object.entries(LOG_ENTRY_SCHEMAS).map(([category, schema]) => [category, collectSensitiveFields(schema)]),
) as Record<LogCategory, readonly string[]>;
