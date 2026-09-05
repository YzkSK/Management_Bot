import { describe, expect, test } from "bun:test";
import {
  LOG_ENTRY_SCHEMAS,
  logEntrySchema,
  parseLogEntry,
  safeParseLogEntry,
  type LogCategory,
} from "./log-entry.js";

const validByCategory = {
  message: {
    category: "message",
    guildId: "1",
    createdAt: "2026-08-30T00:00:00.000Z",
    channelId: "2",
    authorId: "3",
    action: "create",
  },
  member: {
    category: "member",
    guildId: "1",
    createdAt: "2026-08-30T00:00:00.000Z",
    userId: "2",
    action: "join",
  },
  role: {
    category: "role",
    guildId: "1",
    createdAt: "2026-08-30T00:00:00.000Z",
    roleId: "2",
    action: "create",
  },
  channel: {
    category: "channel",
    guildId: "1",
    createdAt: "2026-08-30T00:00:00.000Z",
    channelId: "2",
    action: "create",
  },
  guild: {
    category: "guild",
    guildId: "1",
    createdAt: "2026-08-30T00:00:00.000Z",
    action: "update",
  },
  thread: {
    category: "thread",
    guildId: "1",
    createdAt: "2026-08-30T00:00:00.000Z",
    threadId: "2",
    channelId: "3",
    action: "create",
  },
  invite: {
    category: "invite",
    guildId: "1",
    createdAt: "2026-08-30T00:00:00.000Z",
    code: "abc",
    channelId: "2",
    action: "create",
  },
  emoji: {
    category: "emoji",
    guildId: "1",
    createdAt: "2026-08-30T00:00:00.000Z",
    emojiId: "2",
    action: "create",
  },
  autoMod: {
    category: "autoMod",
    guildId: "1",
    createdAt: "2026-08-30T00:00:00.000Z",
    ruleId: "2",
    userId: "3",
    action: "actionExecuted",
  },
  integration: {
    category: "integration",
    guildId: "1",
    createdAt: "2026-08-30T00:00:00.000Z",
    integrationId: "2",
    action: "create",
  },
  poll: {
    category: "poll",
    guildId: "1",
    createdAt: "2026-08-30T00:00:00.000Z",
    messageId: "2",
    channelId: "3",
    action: "create",
  },
  scheduledEvent: {
    category: "scheduledEvent",
    guildId: "1",
    createdAt: "2026-08-30T00:00:00.000Z",
    eventId: "2",
    action: "create",
  },
  stage: {
    category: "stage",
    guildId: "1",
    createdAt: "2026-08-30T00:00:00.000Z",
    stageInstanceId: "2",
    channelId: "3",
    action: "start",
  },
  auditLogCorrelation: {
    category: "auditLogCorrelation",
    guildId: "1",
    createdAt: "2026-08-30T00:00:00.000Z",
    auditLogEntryId: "2",
    actionType: "MEMBER_KICK",
  },
  moderationCase: {
    category: "moderationCase",
    guildId: "1",
    createdAt: "2026-08-30T00:00:00.000Z",
    caseId: "2",
    targetUserId: "3",
    moderatorId: "4",
    action: "create",
    actionType: "warn",
  },
  voice: {
    category: "voice",
    guildId: "1",
    createdAt: "2026-08-30T00:00:00.000Z",
    userId: "2",
    channelId: "3",
    action: "join",
  },
} satisfies Record<LogCategory, unknown>;

describe("logEntrySchema", () => {
  for (const category of Object.keys(LOG_ENTRY_SCHEMAS) as LogCategory[]) {
    test(`${category}: 正常な入力はparseに成功する`, () => {
      expect(() => parseLogEntry(validByCategory[category])).not.toThrow();
    });
  }

  test("guildIdが空文字の場合は失敗する", () => {
    const result = safeParseLogEntry({
      ...validByCategory.message,
      guildId: "",
    });
    expect(result.success).toBe(false);
  });

  test("必須フィールド(channelId)が空文字の場合は失敗する", () => {
    const result = safeParseLogEntry({
      ...validByCategory.message,
      channelId: "",
    });
    expect(result.success).toBe(false);
  });

  test("未知のcategoryはsafeParseで失敗する", () => {
    const result = safeParseLogEntry({
      category: "unknown",
      guildId: "1",
      createdAt: "2026-08-30T00:00:00.000Z",
    });
    expect(result.success).toBe(false);
  });

  test("必須フィールド欠落はsafeParseで失敗する", () => {
    const result = safeParseLogEntry({
      category: "message",
      guildId: "1",
      createdAt: "2026-08-30T00:00:00.000Z",
    });
    expect(result.success).toBe(false);
  });

  test("actionが許可されていない値の場合は失敗する", () => {
    const result = logEntrySchema.safeParse({
      ...validByCategory.message,
      action: "notAnAction",
    });
    expect(result.success).toBe(false);
  });

  test("createdAtがISO日時でない場合は失敗する", () => {
    const result = logEntrySchema.safeParse({
      ...validByCategory.message,
      createdAt: "not-a-date",
    });
    expect(result.success).toBe(false);
  });
});
