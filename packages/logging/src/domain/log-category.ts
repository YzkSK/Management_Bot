import { z } from "zod";
import { LOG_CATEGORIES, MODERATION_ACTION_TYPES } from "@management-bot/shared";

const nonEmptyString = z.string().min(1);

const base = {
  guildId: nonEmptyString,
  createdAt: z.iso.datetime(),
};

export const messageLogEntrySchema = z.object({
  ...base,
  category: z.literal("message"),
  channelId: nonEmptyString,
  authorId: nonEmptyString,
  action: z.enum(["create", "update", "delete", "bulkDelete"]),
  content: z.string().optional(),
});

export const memberLogEntrySchema = z.object({
  ...base,
  category: z.literal("member"),
  userId: nonEmptyString,
  action: z.enum(["join", "leave", "ban", "unban", "kick", "timeout", "nicknameChange"]),
});

export const roleLogEntrySchema = z.object({
  ...base,
  category: z.literal("role"),
  roleId: nonEmptyString,
  action: z.enum(["create", "update", "delete", "memberAdd", "memberRemove"]),
});

export const channelLogEntrySchema = z.object({
  ...base,
  category: z.literal("channel"),
  channelId: nonEmptyString,
  action: z.enum(["create", "update", "delete"]),
});

export const guildLogEntrySchema = z.object({
  ...base,
  category: z.literal("guild"),
  action: z.enum(["update"]),
});

export const threadLogEntrySchema = z.object({
  ...base,
  category: z.literal("thread"),
  threadId: nonEmptyString,
  channelId: nonEmptyString,
  action: z.enum(["create", "update", "delete", "archive", "unarchive"]),
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

export const autoModLogEntrySchema = z.object({
  ...base,
  category: z.literal("autoMod"),
  ruleId: nonEmptyString,
  userId: nonEmptyString,
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
  executorId: nonEmptyString.optional(),
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

export const LOG_ENTRY_SCHEMAS = {
  message: messageLogEntrySchema,
  member: memberLogEntrySchema,
  role: roleLogEntrySchema,
  channel: channelLogEntrySchema,
  guild: guildLogEntrySchema,
  thread: threadLogEntrySchema,
  invite: inviteLogEntrySchema,
  emoji: emojiLogEntrySchema,
  autoMod: autoModLogEntrySchema,
  integration: integrationLogEntrySchema,
  poll: pollLogEntrySchema,
  scheduledEvent: scheduledEventLogEntrySchema,
  stage: stageLogEntrySchema,
  auditLogCorrelation: auditLogCorrelationEntrySchema,
  moderationCase: moderationCaseLogEntrySchema,
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
