import { describe, expect, test } from "bun:test";
import {
  LOG_ENTRY_SCHEMAS,
  logEntrySchema,
  parseLogEntry,
  safeParseLogEntry,
  SENSITIVE_LOG_FIELDS,
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
  reaction: {
    category: "reaction",
    guildId: "1",
    createdAt: "2026-08-30T00:00:00.000Z",
    channelId: "2",
    messageId: "3",
    userId: "4",
    emoji: "😀",
    action: "add",
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
  sticker: {
    category: "sticker",
    guildId: "1",
    createdAt: "2026-08-30T00:00:00.000Z",
    stickerId: "2",
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

  test("role: changesが空オブジェクトの場合は失敗する(差分なしのupdateを表現させない)", () => {
    const result = logEntrySchema.safeParse({
      ...validByCategory.role,
      action: "update",
      changes: {},
    });
    expect(result.success).toBe(false);
  });

  test("role: changesにフィールドごとのbefore/afterがある場合は成功する", () => {
    const result = logEntrySchema.safeParse({
      ...validByCategory.role,
      action: "update",
      changes: { name: { before: "old", after: "new" } },
    });
    expect(result.success).toBe(true);
  });

  test("voice: action=updateでchangesが空オブジェクトの場合は失敗する(差分なしのupdateを表現させない)", () => {
    const result = logEntrySchema.safeParse({
      ...validByCategory.voice,
      action: "update",
      changes: {},
    });
    expect(result.success).toBe(false);
  });

  test("voice: action=updateでselfMute/streamingのbefore/afterがある場合は成功する", () => {
    const result = logEntrySchema.safeParse({
      ...validByCategory.voice,
      action: "update",
      changes: { selfMute: { before: false, after: true }, streaming: { before: false, after: true } },
    });
    expect(result.success).toBe(true);
  });

  test("voice: action=updateでchangesに未知のフラグ名が含まれる場合は失敗する", () => {
    const result = logEntrySchema.safeParse({
      ...validByCategory.voice,
      action: "update",
      changes: { unknownFlag: { before: false, after: true } },
    });
    expect(result.success).toBe(false);
  });

  test("channel: changesが空オブジェクトの場合は失敗する(差分なしのupdateを表現させない)", () => {
    const result = logEntrySchema.safeParse({
      ...validByCategory.channel,
      action: "update",
      changes: {},
    });
    expect(result.success).toBe(false);
  });

  test("channel: changesにtopicのnull(未設定)を含む場合も成功する", () => {
    const result = logEntrySchema.safeParse({
      ...validByCategory.channel,
      action: "update",
      changes: { topic: { before: null, after: "new topic" } },
    });
    expect(result.success).toBe(true);
  });

  test("guild: changesが空オブジェクトの場合は失敗する(差分なしのupdateを表現させない)", () => {
    const result = logEntrySchema.safeParse({
      ...validByCategory.guild,
      action: "update",
      changes: {},
    });
    expect(result.success).toBe(false);
  });

  test("guild: changesにiconのnull(未設定)を含む場合も成功する", () => {
    const result = logEntrySchema.safeParse({
      ...validByCategory.guild,
      action: "update",
      changes: { icon: { before: null, after: "hash" } },
    });
    expect(result.success).toBe(true);
  });
  test("member: nicknameChange permits setting a nickname", () => {
    const changes = { nickname: { before: null, after: "新しい名前" } };
    const result = logEntrySchema.safeParse({
      ...validByCategory.member,
      action: "nicknameChange",
      changes,
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.changes).toEqual(changes);
  });

  test("member: nicknameChange permits clearing a nickname", () => {
    const changes = { nickname: { before: "以前の名前", after: null } };
    const result = logEntrySchema.safeParse({
      ...validByCategory.member,
      action: "nicknameChange",
      changes,
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.changes).toEqual(changes);
  });
});

describe("SENSITIVE_LOG_FIELDS", () => {
  test("message.previousContentをマスク対象として検出する(schema上.meta({sensitive:true})指定)", () => {
    expect(SENSITIVE_LOG_FIELDS.message).toContain("previousContent");
  });

  test("channel/guild/roleのchangesをマスク対象として検出する", () => {
    expect(SENSITIVE_LOG_FIELDS.channel).toContain("changes");
    expect(SENSITIVE_LOG_FIELDS.guild).toContain("changes");
    expect(SENSITIVE_LOG_FIELDS.role).toContain("changes");
  });

  test("sensitiveマークのないカテゴリは空配列を返す", () => {
    expect(SENSITIVE_LOG_FIELDS.member).toEqual([]);
    expect(SENSITIVE_LOG_FIELDS.reaction).toEqual([]);
    expect(SENSITIVE_LOG_FIELDS.voice).toEqual([]);
  });

  test("全カテゴリ分のエントリを持つ", () => {
    expect(Object.keys(SENSITIVE_LOG_FIELDS).sort()).toEqual(Object.keys(LOG_ENTRY_SCHEMAS).sort());
  });
});
