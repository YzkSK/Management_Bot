import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import {
  createDb,
  capabilityGrants,
  guilds,
  logChannelSettings,
  logDisplaySettings,
  logEntries,
  logRetentionSettings,
  sessions,
} from "@management-bot/db";
import { CAPABILITIES } from "@management-bot/shared";
import {
  createCallerFactory,
  type ChannelOption,
  type GuildMembership,
  type MemberPage,
  type RoleOption,
} from "@management-bot/dashboard-access";
import { TRPCError } from "@trpc/server";
import { PermissionFlagsBits } from "discord.js";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { loggingRouter } from "./index.js";
import { LOGGING_REQUIRED_PERMISSIONS } from "../discord/required-permissions.js";

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
    discordUsername: "user-1-name",
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
      action: "update",
      content: "secret message",
      previousContent: "secret previous message",
    },
    createdAt: new Date("2026-08-31T00:00:00.000Z"),
  });
  await db.insert(logEntries).values({
    id: randomUUID(),
    guildId,
    category: "auditLogCorrelation",
    payload: {
      category: "auditLogCorrelation",
      guildId,
      createdAt: "2026-08-31T00:00:01.000Z",
      auditLogEntryId: "audit-1",
      targetId: "t1",
      actionType: "MEMBER_KICK",
    },
    createdAt: new Date("2026-08-31T00:00:01.000Z"),
  });
  await db.delete(logDisplaySettings).where(eq(logDisplaySettings.guildId, guildId));
});

const createCaller = createCallerFactory(loggingRouter);

function memberOf(...guildIds: string[]) {
  return async (guildId: string): Promise<GuildMembership | null> =>
    guildIds.includes(guildId) ? { isOwner: false, roleIds: [] } : null;
}

function channelsOf(...options: ChannelOption[]) {
  return async (): Promise<readonly ChannelOption[]> => options;
}

function verifyGuildChannelOf(...options: ChannelOption[]) {
  return async (_guildId: string, channelId: string): Promise<boolean> =>
    options.some((option) => option.id === channelId);
}

function memberNamesOf(names: Record<string, string>) {
  return async (_guildId: string, userIds: readonly string[]): Promise<ReadonlyMap<string, string>> =>
    new Map(userIds.filter((id) => id in names).map((id) => [id, names[id] as string]));
}

const botPermissionsOf = (permissions = 0n) => async (): Promise<bigint> => permissions;

const rolesOf = () => async (): Promise<RoleOption[]> => [];

const membersPageOf = () => async (): Promise<MemberPage> => ({ members: [], nextAfter: undefined });

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
      getAllGuildChannels: channelsOf(),
      verifyGuildChannel: verifyGuildChannelOf(),
      getGuildMemberNames: memberNamesOf({}),
      getBotPermissions: botPermissionsOf(),
      getGuildRoles: rolesOf(),
      getGuildMembersPage: membersPageOf(),
      discordClientId: "test-client-id",
    });

    const result = await caller.listLogEntries({ guildId, limit: 50 });

    expect(result.hasRawAccess).toBe(false);
    expect(result.entries).toHaveLength(1);
    expect((result.entries[0]?.entry as { content?: string }).content).toBeUndefined();
    expect(
      (result.entries[0]?.entry as { previousContent?: string }).previousContent,
    ).toBeUndefined();
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
      getAllGuildChannels: channelsOf(),
      verifyGuildChannel: verifyGuildChannelOf(),
      getGuildMemberNames: memberNamesOf({}),
      getBotPermissions: botPermissionsOf(),
      getGuildRoles: rolesOf(),
      getGuildMembersPage: membersPageOf(),
      discordClientId: "test-client-id",
    });

    const result = await caller.listLogEntries({ guildId, limit: 50 });

    expect(result.hasRawAccess).toBe(true);
    expect((result.entries[0]?.entry as { content?: string }).content).toBe("secret message");
    expect(
      (result.entries[0]?.entry as { previousContent?: string }).previousContent,
    ).toBe("secret previous message");
  });

  test("VIEW_LOGSを持たない場合はFORBIDDEN", async () => {
    const caller = createCaller({
      db,
      sessionId: "session-1",
      getGuildMembership: memberOf(guildId),
      getGuildChannels: channelsOf(),
      getAllGuildChannels: channelsOf(),
      verifyGuildChannel: verifyGuildChannelOf(),
      getGuildMemberNames: memberNamesOf({}),
      getBotPermissions: botPermissionsOf(),
      getGuildRoles: rolesOf(),
      getGuildMembersPage: membersPageOf(),
      discordClientId: "test-client-id",
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
      getAllGuildChannels: channelsOf(),
      verifyGuildChannel: verifyGuildChannelOf(),
      getGuildMemberNames: memberNamesOf({}),
      getBotPermissions: botPermissionsOf(),
      getGuildRoles: rolesOf(),
      getGuildMembersPage: membersPageOf(),
      discordClientId: "test-client-id",
    });

    await expect(caller.listRetentionSettings({ guildId })).rejects.toThrow();
  });

  test("MANAGE_LOGGING_SETTINGSを持たない場合はFORBIDDEN(set)", async () => {
    const caller = createCaller({
      db,
      sessionId: "session-1",
      getGuildMembership: memberOf(guildId),
      getGuildChannels: channelsOf(),
      getAllGuildChannels: channelsOf(),
      verifyGuildChannel: verifyGuildChannelOf(),
      getGuildMemberNames: memberNamesOf({}),
      getBotPermissions: botPermissionsOf(),
      getGuildRoles: rolesOf(),
      getGuildMembersPage: membersPageOf(),
      discordClientId: "test-client-id",
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
      getAllGuildChannels: channelsOf(),
      verifyGuildChannel: verifyGuildChannelOf(),
      getGuildMemberNames: memberNamesOf({}),
      getBotPermissions: botPermissionsOf(),
      getGuildRoles: rolesOf(),
      getGuildMembersPage: membersPageOf(),
      discordClientId: "test-client-id",
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
      getAllGuildChannels: channelsOf(),
      verifyGuildChannel: verifyGuildChannelOf(),
      getGuildMemberNames: memberNamesOf({}),
      getBotPermissions: botPermissionsOf(),
      getGuildRoles: rolesOf(),
      getGuildMembersPage: membersPageOf(),
      discordClientId: "test-client-id",
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
      getAllGuildChannels: channelsOf(),
      verifyGuildChannel: verifyGuildChannelOf(),
      getGuildMemberNames: memberNamesOf({}),
      getBotPermissions: botPermissionsOf(),
      getGuildRoles: rolesOf(),
      getGuildMembersPage: membersPageOf(),
      discordClientId: "test-client-id",
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
      getAllGuildChannels: channelsOf(),
      verifyGuildChannel: verifyGuildChannelOf(),
      getGuildMemberNames: memberNamesOf({}),
      getBotPermissions: botPermissionsOf(),
      getGuildRoles: rolesOf(),
      getGuildMembersPage: membersPageOf(),
      discordClientId: "test-client-id",
    });

    await expect(caller.listChannelSettings({ guildId })).rejects.toThrow();
  });

  test("MANAGE_LOGGING_SETTINGSを持たない場合はFORBIDDEN(listChannelOptions)", async () => {
    const caller = createCaller({
      db,
      sessionId: "session-1",
      getGuildMembership: memberOf(guildId),
      getGuildChannels: channelsOf({ id: "c1", name: "general" }),
      getAllGuildChannels: channelsOf({ id: "c1", name: "general" }),
      verifyGuildChannel: verifyGuildChannelOf({ id: "c1", name: "general" }),
      getGuildMemberNames: memberNamesOf({}),
      getBotPermissions: botPermissionsOf(),
      getGuildRoles: rolesOf(),
      getGuildMembersPage: membersPageOf(),
      discordClientId: "test-client-id",
    });

    await expect(caller.listChannelOptions({ guildId })).rejects.toThrow();
  });

  test("MANAGE_LOGGING_SETTINGSを持たない場合はFORBIDDEN(set)", async () => {
    const caller = createCaller({
      db,
      sessionId: "session-1",
      getGuildMembership: memberOf(guildId),
      getGuildChannels: channelsOf({ id: "c1", name: "general" }),
      getAllGuildChannels: channelsOf({ id: "c1", name: "general" }),
      verifyGuildChannel: verifyGuildChannelOf({ id: "c1", name: "general" }),
      getGuildMemberNames: memberNamesOf({}),
      getBotPermissions: botPermissionsOf(),
      getGuildRoles: rolesOf(),
      getGuildMembersPage: membersPageOf(),
      discordClientId: "test-client-id",
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
      getAllGuildChannels: channelsOf({ id: "c1", name: "general" }),
      verifyGuildChannel: verifyGuildChannelOf({ id: "c1", name: "general" }),
      getGuildMemberNames: memberNamesOf({}),
      getBotPermissions: botPermissionsOf(),
      getGuildRoles: rolesOf(),
      getGuildMembersPage: membersPageOf(),
      discordClientId: "test-client-id",
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
      getAllGuildChannels: channelsOf({ id: "c1", name: "general" }),
      verifyGuildChannel: verifyGuildChannelOf({ id: "c1", name: "general" }),
      getGuildMemberNames: memberNamesOf({}),
      getBotPermissions: botPermissionsOf(),
      getGuildRoles: rolesOf(),
      getGuildMembersPage: membersPageOf(),
      discordClientId: "test-client-id",
    });

    await caller.setChannelSetting({ guildId, category: "message", channelId: "c1" });
    const afterSet = await caller.listChannelSettings({ guildId });
    expect(afterSet.find((r) => r.category === "message")?.channelId).toBe("c1");

    await caller.setChannelSetting({ guildId, category: "message", channelId: null });
    const afterUnset = await caller.listChannelSettings({ guildId });
    expect(afterUnset.find((r) => r.category === "message")?.channelId).toBeNull();
  });

  test("setChannelSettingはgetGuildChannels(表示用キャッシュ)ではなくverifyGuildChannel(生fetch)で実在検証する", async () => {
    await grantManageLoggingSettings();
    const caller = createCaller({
      db,
      sessionId: "session-1",
      getGuildMembership: memberOf(guildId),
      // getGuildChannelsは古いキャッシュを想定してc1を含むが、verifyGuildChannelは
      // 最新状態(c1は削除済み)を返す。mutation検証がverifyGuildChannel経由であることを保証する。
      getGuildChannels: channelsOf({ id: "c1", name: "general" }),
      getAllGuildChannels: channelsOf({ id: "c1", name: "general" }),
      verifyGuildChannel: verifyGuildChannelOf(),
      getGuildMemberNames: memberNamesOf({}),
      getBotPermissions: botPermissionsOf(),
      getGuildRoles: rolesOf(),
      getGuildMembersPage: membersPageOf(),
      discordClientId: "test-client-id",
    });

    const thrown = await captureRejection(
      caller.setChannelSetting({ guildId, category: "message", channelId: "c1" }),
    );

    expect((thrown as TRPCError).code).toBe("BAD_REQUEST");
  });

  test("実在しないチャンネルIDを設定しようとするとBAD_REQUEST", async () => {
    await grantManageLoggingSettings();
    const caller = createCaller({
      db,
      sessionId: "session-1",
      getGuildMembership: memberOf(guildId),
      getGuildChannels: channelsOf({ id: "c1", name: "general" }),
      getAllGuildChannels: channelsOf({ id: "c1", name: "general" }),
      verifyGuildChannel: verifyGuildChannelOf({ id: "c1", name: "general" }),
      getGuildMemberNames: memberNamesOf({}),
      getBotPermissions: botPermissionsOf(),
      getGuildRoles: rolesOf(),
      getGuildMembersPage: membersPageOf(),
      discordClientId: "test-client-id",
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
      getAllGuildChannels: channelsOf({ id: "c1", name: "general" }),
      verifyGuildChannel: verifyGuildChannelOf({ id: "c1", name: "general" }),
      getGuildMemberNames: memberNamesOf({}),
      getBotPermissions: botPermissionsOf(),
      getGuildRoles: rolesOf(),
      getGuildMembersPage: membersPageOf(),
      discordClientId: "test-client-id",
    });

    await caller.setChannelSettingForAllCategories({ guildId, channelId: "c1" });
    const result = await caller.listChannelSettings({ guildId });

    expect(result.every((r) => r.channelId === "c1")).toBe(true);
  });

  test("setChannelSettingForAllCategoriesはchannelId=nullで全カテゴリの設定を削除する", async () => {
    await grantManageLoggingSettings();
    const caller = createCaller({
      db,
      sessionId: "session-1",
      getGuildMembership: memberOf(guildId),
      getGuildChannels: channelsOf({ id: "c1", name: "general" }),
      getAllGuildChannels: channelsOf({ id: "c1", name: "general" }),
      verifyGuildChannel: verifyGuildChannelOf({ id: "c1", name: "general" }),
      getGuildMemberNames: memberNamesOf({}),
      getBotPermissions: botPermissionsOf(),
      getGuildRoles: rolesOf(),
      getGuildMembersPage: membersPageOf(),
      discordClientId: "test-client-id",
    });

    await caller.setChannelSettingForAllCategories({ guildId, channelId: "c1" });
    await caller.setChannelSettingForAllCategories({ guildId, channelId: null });

    const rows = await db.select().from(logChannelSettings).where(eq(logChannelSettings.guildId, guildId));
    expect(rows).toHaveLength(0);
  });

  test("setChannelSettingForAllCategoriesもMANAGE_LOGGING_SETTINGSを持たない場合はFORBIDDEN", async () => {
    const caller = createCaller({
      db,
      sessionId: "session-1",
      getGuildMembership: memberOf(guildId),
      getGuildChannels: channelsOf({ id: "c1", name: "general" }),
      getAllGuildChannels: channelsOf({ id: "c1", name: "general" }),
      verifyGuildChannel: verifyGuildChannelOf({ id: "c1", name: "general" }),
      getGuildMemberNames: memberNamesOf({}),
      getBotPermissions: botPermissionsOf(),
      getGuildRoles: rolesOf(),
      getGuildMembersPage: membersPageOf(),
      discordClientId: "test-client-id",
    });

    const thrown = await captureRejection(caller.setChannelSettingForAllCategories({ guildId, channelId: "c1" }));

    expect(thrown).toBeInstanceOf(TRPCError);
    expect((thrown as TRPCError).code).toBe("FORBIDDEN");
  });

  test("setChannelSettingForAllCategoriesも実在しないチャンネルIDならBAD_REQUEST", async () => {
    await grantManageLoggingSettings();
    const caller = createCaller({
      db,
      sessionId: "session-1",
      getGuildMembership: memberOf(guildId),
      getGuildChannels: channelsOf({ id: "c1", name: "general" }),
      getAllGuildChannels: channelsOf({ id: "c1", name: "general" }),
      verifyGuildChannel: verifyGuildChannelOf({ id: "c1", name: "general" }),
      getGuildMemberNames: memberNamesOf({}),
      getBotPermissions: botPermissionsOf(),
      getGuildRoles: rolesOf(),
      getGuildMembersPage: membersPageOf(),
      discordClientId: "test-client-id",
    });

    const thrown = await captureRejection(
      caller.setChannelSettingForAllCategories({ guildId, channelId: "nonexistent" }),
    );

    expect(thrown).toBeInstanceOf(TRPCError);
    expect((thrown as TRPCError).code).toBe("BAD_REQUEST");
  });
});

describe("loggingRouter.listLogEntries + display settings", () => {
  test("hideAuditLogCorrelation=true(デフォルト)の場合、auditLogCorrelationを除外する", async () => {
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
      getAllGuildChannels: channelsOf(),
      verifyGuildChannel: verifyGuildChannelOf(),
      getGuildMemberNames: memberNamesOf({}),
      getBotPermissions: botPermissionsOf(),
      getGuildRoles: rolesOf(),
      getGuildMembersPage: membersPageOf(),
      discordClientId: "test-client-id",
    });

    const result = await caller.listLogEntries({ guildId, limit: 50 });

    expect(result.entries.map(({ entry }) => entry.category).sort()).toEqual(["message"]);
  });

  test("category=auditLogCorrelationを明示指定した場合は除外しない", async () => {
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
      getAllGuildChannels: channelsOf(),
      verifyGuildChannel: verifyGuildChannelOf(),
      getGuildMemberNames: memberNamesOf({}),
      getBotPermissions: botPermissionsOf(),
      getGuildRoles: rolesOf(),
      getGuildMembersPage: membersPageOf(),
      discordClientId: "test-client-id",
    });

    const result = await caller.listLogEntries({ guildId, category: "auditLogCorrelation", limit: 50 });

    expect(result.entries.map(({ entry }) => entry.category)).toEqual(["auditLogCorrelation"]);
  });

  test("getDisplaySettings/setDisplaySettingで設定を読み書きでき、listLogEntriesに反映される", async () => {
    await db.insert(capabilityGrants).values({
      id: randomUUID(),
      guildId,
      targetType: "user",
      targetId: "user-1",
      capabilities: CAPABILITIES.VIEW_LOGS | CAPABILITIES.MANAGE_LOGGING_SETTINGS,
    });
    const caller = createCaller({
      db,
      sessionId: "session-1",
      getGuildMembership: memberOf(guildId),
      getGuildChannels: channelsOf(),
      getAllGuildChannels: channelsOf(),
      verifyGuildChannel: verifyGuildChannelOf(),
      getGuildMemberNames: memberNamesOf({}),
      getBotPermissions: botPermissionsOf(),
      getGuildRoles: rolesOf(),
      getGuildMembersPage: membersPageOf(),
      discordClientId: "test-client-id",
    });

    const before = await caller.getDisplaySettings({ guildId });
    expect(before.hideAuditLogCorrelation).toBe(true);

    await caller.setDisplaySetting({ guildId, hideAuditLogCorrelation: false, hideBotEvents: true });
    const after = await caller.getDisplaySettings({ guildId });
    expect(after.hideAuditLogCorrelation).toBe(false);

    const shown = await caller.listLogEntries({ guildId, limit: 50 });
    expect(shown.entries.map(({ entry }) => entry.category).sort()).toEqual(
      ["auditLogCorrelation", "message"].sort(),
    );

    await caller.setDisplaySetting({ guildId, hideAuditLogCorrelation: true, hideBotEvents: true });
    const hiddenAgain = await caller.listLogEntries({ guildId, limit: 50 });
    expect(hiddenAgain.entries.map(({ entry }) => entry.category)).toEqual(["message"]);
  });

  test("hideBotEvents=true(デフォルト)の場合、authorIsBot=trueの行を除外し、falseにすると表示される", async () => {
    await db.insert(capabilityGrants).values({
      id: randomUUID(),
      guildId,
      targetType: "user",
      targetId: "user-1",
      capabilities: CAPABILITIES.VIEW_LOGS | CAPABILITIES.MANAGE_LOGGING_SETTINGS,
    });
    await db.insert(logEntries).values({
      id: randomUUID(),
      guildId,
      category: "message",
      authorIsBot: true,
      payload: {
        category: "message",
        guildId,
        createdAt: "2026-08-31T00:00:02.000Z",
        channelId: "c1",
        authorId: "bot1",
        action: "create",
        content: "bot message",
        actorIsBot: true,
      },
      createdAt: new Date("2026-08-31T00:00:02.000Z"),
    });
    const caller = createCaller({
      db,
      sessionId: "session-1",
      getGuildMembership: memberOf(guildId),
      getGuildChannels: channelsOf(),
      getAllGuildChannels: channelsOf(),
      verifyGuildChannel: verifyGuildChannelOf(),
      getGuildMemberNames: memberNamesOf({}),
      getBotPermissions: botPermissionsOf(),
      getGuildRoles: rolesOf(),
      getGuildMembersPage: membersPageOf(),
      discordClientId: "test-client-id",
    });

    const hidden = await caller.listLogEntries({ guildId, limit: 50 });
    expect(hidden.entries.every(({ entry }) => (entry as { authorId?: string }).authorId !== "bot1")).toBe(true);

    await caller.setDisplaySetting({ guildId, hideBotEvents: false });
    const shown = await caller.listLogEntries({ guildId, limit: 50 });
    expect(shown.entries.some(({ entry }) => (entry as { authorId?: string }).authorId === "bot1")).toBe(true);
  });

  test("MANAGE_LOGGING_SETTINGSを持たない場合はFORBIDDEN(getDisplaySettings/setDisplaySetting)", async () => {
    const caller = createCaller({
      db,
      sessionId: "session-1",
      getGuildMembership: memberOf(guildId),
      getGuildChannels: channelsOf(),
      getAllGuildChannels: channelsOf(),
      verifyGuildChannel: verifyGuildChannelOf(),
      getGuildMemberNames: memberNamesOf({}),
      getBotPermissions: botPermissionsOf(),
      getGuildRoles: rolesOf(),
      getGuildMembersPage: membersPageOf(),
      discordClientId: "test-client-id",
    });

    const getThrown = await captureRejection(caller.getDisplaySettings({ guildId }));
    expect(getThrown).toBeInstanceOf(TRPCError);
    expect((getThrown as TRPCError).code).toBe("FORBIDDEN");

    const setThrown = await captureRejection(
      caller.setDisplaySetting({ guildId, hideAuditLogCorrelation: false, hideBotEvents: false }),
    );
    expect(setThrown).toBeInstanceOf(TRPCError);
    expect((setThrown as TRPCError).code).toBe("FORBIDDEN");

    const rows = await db.select().from(logDisplaySettings).where(eq(logDisplaySettings.guildId, guildId));
    expect(rows).toHaveLength(0);
  });
});

describe("loggingRouter.resolveDisplayNames", () => {
  test("resolveDisplayNamesはgetGuildMemberNames/getAllGuildChannelsを介してid→nameを返す(ボイスチャンネル含む)", async () => {
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
      getAllGuildChannels: channelsOf({ id: "c1", name: "general" }, { id: "c2", name: "voice" }),
      verifyGuildChannel: verifyGuildChannelOf({ id: "c1", name: "general" }),
      getGuildMemberNames: memberNamesOf({ u1: "解決された名前" }),
      getBotPermissions: botPermissionsOf(),
      getGuildRoles: rolesOf(),
      getGuildMembersPage: membersPageOf(),
      discordClientId: "test-client-id",
    });

    const result = await caller.resolveDisplayNames({ guildId, userIds: ["u1"], channelIds: ["c1", "c2"] });

    expect(result).toEqual({
      users: { u1: "解決された名前" },
      channels: { c1: "general", c2: "voice" },
    });
  });

  test("VIEW_LOGSを持たない場合はFORBIDDEN", async () => {
    const caller = createCaller({
      db,
      sessionId: "session-1",
      getGuildMembership: memberOf(guildId),
      getGuildChannels: channelsOf(),
      getAllGuildChannels: channelsOf(),
      verifyGuildChannel: verifyGuildChannelOf(),
      getGuildMemberNames: memberNamesOf({}),
      getBotPermissions: botPermissionsOf(),
      getGuildRoles: rolesOf(),
      getGuildMembersPage: membersPageOf(),
      discordClientId: "test-client-id",
    });

    await expect(caller.resolveDisplayNames({ guildId, userIds: [], channelIds: [] })).rejects.toThrow();
  });
});

describe("loggingRouter.getAuditLogPermissionStatus", () => {
  test("ViewAuditLog権限がある場合はhasViewAuditLog:trueかつreauthorizeUrl:null", async () => {
    await db.insert(capabilityGrants).values({
      id: randomUUID(),
      guildId,
      targetType: "user",
      targetId: "user-1",
      capabilities: CAPABILITIES.MANAGE_LOGGING_SETTINGS,
    });
    const caller = createCaller({
      db,
      sessionId: "session-1",
      getGuildMembership: memberOf(guildId),
      getGuildChannels: channelsOf(),
      getAllGuildChannels: channelsOf(),
      verifyGuildChannel: verifyGuildChannelOf(),
      getGuildMemberNames: memberNamesOf({}),
      getBotPermissions: botPermissionsOf(LOGGING_REQUIRED_PERMISSIONS),
      getGuildRoles: rolesOf(),
      getGuildMembersPage: membersPageOf(),
      discordClientId: "test-client-id",
    });

    const result = await caller.getAuditLogPermissionStatus({ guildId });

    expect(result).toEqual({ hasViewAuditLog: true, reauthorizeUrl: null });
  });

  test("ADMINISTRATORを持つ場合もhasViewAuditLog:trueかつreauthorizeUrl:null", async () => {
    await db.insert(capabilityGrants).values({
      id: randomUUID(),
      guildId,
      targetType: "user",
      targetId: "user-1",
      capabilities: CAPABILITIES.MANAGE_LOGGING_SETTINGS,
    });
    const caller = createCaller({
      db,
      sessionId: "session-1",
      getGuildMembership: memberOf(guildId),
      getGuildChannels: channelsOf(),
      getAllGuildChannels: channelsOf(),
      verifyGuildChannel: verifyGuildChannelOf(),
      getGuildMemberNames: memberNamesOf({}),
      getBotPermissions: botPermissionsOf(PermissionFlagsBits.Administrator),
      getGuildRoles: rolesOf(),
      getGuildMembersPage: membersPageOf(),
      discordClientId: "test-client-id",
    });

    const result = await caller.getAuditLogPermissionStatus({ guildId });

    expect(result).toEqual({ hasViewAuditLog: true, reauthorizeUrl: null });
  });

  test("ViewAuditLog権限がない場合は必要な権限のみを含む再認可URLを返す", async () => {
    await db.insert(capabilityGrants).values({
      id: randomUUID(),
      guildId,
      targetType: "user",
      targetId: "user-1",
      capabilities: CAPABILITIES.MANAGE_LOGGING_SETTINGS,
    });
    const caller = createCaller({
      db,
      sessionId: "session-1",
      getGuildMembership: memberOf(guildId),
      getGuildChannels: channelsOf(),
      getAllGuildChannels: channelsOf(),
      verifyGuildChannel: verifyGuildChannelOf(),
      getGuildMemberNames: memberNamesOf({}),
      getBotPermissions: botPermissionsOf(0n),
      getGuildRoles: rolesOf(),
      getGuildMembersPage: membersPageOf(),
      discordClientId: "test-client-id",
    });

    const result = await caller.getAuditLogPermissionStatus({ guildId });

    expect(result.hasViewAuditLog).toBe(false);
    const url = new URL(result.reauthorizeUrl ?? "");
    expect(url.searchParams.get("client_id")).toBe("test-client-id");
    expect(url.searchParams.get("permissions")).toBe(LOGGING_REQUIRED_PERMISSIONS.toString());
    expect(url.searchParams.get("guild_id")).toBe(guildId);
    expect(url.searchParams.get("disable_guild_select")).toBe("true");
  });

  test("MANAGE_LOGGING_SETTINGSを持たない場合はFORBIDDEN", async () => {
    const caller = createCaller({
      db,
      sessionId: "session-1",
      getGuildMembership: memberOf(guildId),
      getGuildChannels: channelsOf(),
      getAllGuildChannels: channelsOf(),
      verifyGuildChannel: verifyGuildChannelOf(),
      getGuildMemberNames: memberNamesOf({}),
      getBotPermissions: botPermissionsOf(),
      getGuildRoles: rolesOf(),
      getGuildMembersPage: membersPageOf(),
      discordClientId: "test-client-id",
    });

    await expect(caller.getAuditLogPermissionStatus({ guildId })).rejects.toThrow(TRPCError);
  });
});
