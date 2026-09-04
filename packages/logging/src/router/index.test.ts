import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import {
  createDb,
  capabilityGrants,
  guilds,
  logChannelSettings,
  logEntries,
  logRetentionSettings,
  sessions,
} from "@management-bot/db";
import { CAPABILITIES } from "@management-bot/shared";
import {
  createCallerFactory,
  type ChannelOption,
  type GuildMembership,
} from "@management-bot/dashboard-access";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { loggingRouter } from "./index.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required to run this test");

const { db, close } = createDb(databaseUrl);
const guildId = `test-guild-${randomUUID()}`;

afterAll(async () => {
  await db.delete(guilds).where(eq(guilds.id, guildId));
  await close();
});

beforeEach(async () => {
  await db.delete(sessions).where(eq(sessions.id, "session-1"));
  await db.delete(guilds).where(eq(guilds.id, guildId));
  await db.insert(guilds).values({ id: guildId, name: "guild" });
  await db.insert(sessions).values({
    id: "session-1",
    discordUserId: "user-1",
    encryptedAccessToken: "test-access-token",
    encryptedRefreshToken: "test-refresh-token",
    expiresAt: new Date(Date.now() + 60_000),
  });
  await db.insert(logEntries).values({
    id: randomUUID(),
    guildId,
    category: "message",
    payload: {
      category: "message",
      guildId,
      createdAt: "2026-08-31T00:00:00.000Z",
      channelId: "c1",
      authorId: "a1",
      action: "create",
      content: "secret message",
    },
    createdAt: new Date("2026-08-31T00:00:00.000Z"),
  });
});

const createCaller = createCallerFactory(loggingRouter);

function memberOf(...guildIds: string[]) {
  return async (guildId: string): Promise<GuildMembership | null> =>
    guildIds.includes(guildId) ? { isOwner: false, roleIds: [] } : null;
}

function channelsOf(...options: ChannelOption[]) {
  return async (): Promise<readonly ChannelOption[]> => options;
}

describe("loggingRouter.listLogEntries", () => {
  test("VIEW_LOGSのみを持つ場合はcontentがマスクされる", async () => {
    await db.insert(capabilityGrants).values({
      id: randomUUID(),
      guildId,
      targetType: "user",
      targetId: "user-1",
      capabilities: CAPABILITIES.VIEW_LOGS,
    });
    const caller = createCaller({
      db,
      sessionId: "session-1",
      getGuildMembership: memberOf(guildId),
      getGuildChannels: channelsOf(),
    });

    const result = await caller.listLogEntries({ guildId, limit: 50 });

    expect(result.entries).toHaveLength(1);
    expect((result.entries[0]?.entry as { content?: string }).content).toBeUndefined();
  });

  test("VIEW_LOGS_RAWも持つ場合はcontentがそのまま返る", async () => {
    await db.insert(capabilityGrants).values({
      id: randomUUID(),
      guildId,
      targetType: "user",
      targetId: "user-1",
      capabilities: CAPABILITIES.VIEW_LOGS | CAPABILITIES.VIEW_LOGS_RAW,
    });
    const caller = createCaller({
      db,
      sessionId: "session-1",
      getGuildMembership: memberOf(guildId),
      getGuildChannels: channelsOf(),
    });

    const result = await caller.listLogEntries({ guildId, limit: 50 });

    expect((result.entries[0]?.entry as { content?: string }).content).toBe("secret message");
  });

  test("VIEW_LOGSを持たない場合はFORBIDDEN", async () => {
    const caller = createCaller({
      db,
      sessionId: "session-1",
      getGuildMembership: memberOf(guildId),
      getGuildChannels: channelsOf(),
    });

    await expect(caller.listLogEntries({ guildId, limit: 50 })).rejects.toThrow();
  });
});

async function grantManageLoggingSettings(): Promise<void> {
  await db.insert(capabilityGrants).values({
    id: randomUUID(),
    guildId,
    targetType: "user",
    targetId: "user-1",
    capabilities: CAPABILITIES.MANAGE_LOGGING_SETTINGS,
  });
}

/**
 * expect(promise).rejects.toThrow()はmutation呼び出しに対してbun:testがハングする
 * 既知の相性問題があるため、try/catchで代替する。
 */
async function captureRejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    return undefined;
  } catch (e) {
    return e;
  }
}

describe("loggingRouter.listRetentionSettings / setRetentionSetting", () => {
  test("MANAGE_LOGGING_SETTINGSを持たない場合はFORBIDDEN(list)", async () => {
    const caller = createCaller({
      db,
      sessionId: "session-1",
      getGuildMembership: memberOf(guildId),
      getGuildChannels: channelsOf(),
    });

    await expect(caller.listRetentionSettings({ guildId })).rejects.toThrow();
  });

  test("MANAGE_LOGGING_SETTINGSを持たない場合はFORBIDDEN(set)", async () => {
    const caller = createCaller({
      db,
      sessionId: "session-1",
      getGuildMembership: memberOf(guildId),
      getGuildChannels: channelsOf(),
    });

    const thrown = await captureRejection(
      caller.setRetentionSetting({ guildId, category: "message", retentionDays: 30 }),
    );

    expect(thrown).toBeInstanceOf(TRPCError);
    expect((thrown as TRPCError).code).toBe("FORBIDDEN");
    const rows = await db
      .select()
      .from(logRetentionSettings)
      .where(eq(logRetentionSettings.guildId, guildId));
    expect(rows).toHaveLength(0);
  });

  test("設定の取得・更新ができる", async () => {
    await grantManageLoggingSettings();
    const caller = createCaller({
      db,
      sessionId: "session-1",
      getGuildMembership: memberOf(guildId),
      getGuildChannels: channelsOf(),
    });

    await caller.setRetentionSetting({ guildId, category: "message", retentionDays: 30 });
    const result = await caller.listRetentionSettings({ guildId });

    expect(result.find((r) => r.category === "message")?.retentionDays).toBe(30);
  });

  test("setRetentionSettingForAllCategoriesは全カテゴリを一括で同じ値にする", async () => {
    await grantManageLoggingSettings();
    const caller = createCaller({
      db,
      sessionId: "session-1",
      getGuildMembership: memberOf(guildId),
      getGuildChannels: channelsOf(),
    });

    await caller.setRetentionSettingForAllCategories({ guildId, retentionDays: 60 });
    const result = await caller.listRetentionSettings({ guildId });

    expect(result.every((r) => r.retentionDays === 60)).toBe(true);
  });

  test("setRetentionSettingForAllCategoriesもMANAGE_LOGGING_SETTINGSを持たない場合はFORBIDDEN", async () => {
    const caller = createCaller({
      db,
      sessionId: "session-1",
      getGuildMembership: memberOf(guildId),
      getGuildChannels: channelsOf(),
    });

    const thrown = await captureRejection(caller.setRetentionSettingForAllCategories({ guildId, retentionDays: 60 }));

    expect(thrown).toBeInstanceOf(TRPCError);
    expect((thrown as TRPCError).code).toBe("FORBIDDEN");
  });
});

describe("loggingRouter.listChannelSettings / setChannelSetting / listChannelOptions", () => {
  test("MANAGE_LOGGING_SETTINGSを持たない場合はFORBIDDEN(list)", async () => {
    const caller = createCaller({
      db,
      sessionId: "session-1",
      getGuildMembership: memberOf(guildId),
      getGuildChannels: channelsOf(),
    });

    await expect(caller.listChannelSettings({ guildId })).rejects.toThrow();
  });

  test("MANAGE_LOGGING_SETTINGSを持たない場合はFORBIDDEN(listChannelOptions)", async () => {
    const caller = createCaller({
      db,
      sessionId: "session-1",
      getGuildMembership: memberOf(guildId),
      getGuildChannels: channelsOf({ id: "c1", name: "general" }),
    });

    await expect(caller.listChannelOptions({ guildId })).rejects.toThrow();
  });

  test("MANAGE_LOGGING_SETTINGSを持たない場合はFORBIDDEN(set)", async () => {
    const caller = createCaller({
      db,
      sessionId: "session-1",
      getGuildMembership: memberOf(guildId),
      getGuildChannels: channelsOf({ id: "c1", name: "general" }),
    });

    const thrown = await captureRejection(
      caller.setChannelSetting({ guildId, category: "message", channelId: "c1" }),
    );

    expect(thrown).toBeInstanceOf(TRPCError);
    expect((thrown as TRPCError).code).toBe("FORBIDDEN");
    const rows = await db
      .select()
      .from(logChannelSettings)
      .where(eq(logChannelSettings.guildId, guildId));
    expect(rows).toHaveLength(0);
  });

  test("listChannelOptionsはgetGuildChannelsの結果を返す", async () => {
    await grantManageLoggingSettings();
    const caller = createCaller({
      db,
      sessionId: "session-1",
      getGuildMembership: memberOf(guildId),
      getGuildChannels: channelsOf({ id: "c1", name: "general" }),
    });

    const result = await caller.listChannelOptions({ guildId });

    expect(result).toEqual([{ id: "c1", name: "general" }]);
  });

  test("実在するチャンネルは設定でき、取得・削除もできる", async () => {
    await grantManageLoggingSettings();
    const caller = createCaller({
      db,
      sessionId: "session-1",
      getGuildMembership: memberOf(guildId),
      getGuildChannels: channelsOf({ id: "c1", name: "general" }),
    });

    await caller.setChannelSetting({ guildId, category: "message", channelId: "c1" });
    const afterSet = await caller.listChannelSettings({ guildId });
    expect(afterSet.find((r) => r.category === "message")?.channelId).toBe("c1");

    await caller.setChannelSetting({ guildId, category: "message", channelId: null });
    const afterUnset = await caller.listChannelSettings({ guildId });
    expect(afterUnset.find((r) => r.category === "message")?.channelId).toBeNull();
  });

  test("実在しないチャンネルIDを設定しようとするとBAD_REQUEST", async () => {
    await grantManageLoggingSettings();
    const caller = createCaller({
      db,
      sessionId: "session-1",
      getGuildMembership: memberOf(guildId),
      getGuildChannels: channelsOf({ id: "c1", name: "general" }),
    });

    const thrown = await captureRejection(
      caller.setChannelSetting({ guildId, category: "message", channelId: "nonexistent" }),
    );

    expect(thrown).toBeInstanceOf(TRPCError);
    expect((thrown as TRPCError).code).toBe("BAD_REQUEST");
    const rows = await db
      .select()
      .from(logChannelSettings)
      .where(eq(logChannelSettings.guildId, guildId));
    expect(rows).toHaveLength(0);
  });

  test("setChannelSettingForAllCategoriesは全カテゴリを一括で同じチャンネルにする", async () => {
    await grantManageLoggingSettings();
    const caller = createCaller({
      db,
      sessionId: "session-1",
      getGuildMembership: memberOf(guildId),
      getGuildChannels: channelsOf({ id: "c1", name: "general" }),
    });

    await caller.setChannelSettingForAllCategories({ guildId, channelId: "c1" });
    const result = await caller.listChannelSettings({ guildId });

    expect(result.every((r) => r.channelId === "c1")).toBe(true);
  });

  test("setChannelSettingForAllCategoriesも実在しないチャンネルIDならBAD_REQUEST", async () => {
    await grantManageLoggingSettings();
    const caller = createCaller({
      db,
      sessionId: "session-1",
      getGuildMembership: memberOf(guildId),
      getGuildChannels: channelsOf({ id: "c1", name: "general" }),
    });

    const thrown = await captureRejection(
      caller.setChannelSettingForAllCategories({ guildId, channelId: "nonexistent" }),
    );

    expect(thrown).toBeInstanceOf(TRPCError);
    expect((thrown as TRPCError).code).toBe("BAD_REQUEST");
  });
});
