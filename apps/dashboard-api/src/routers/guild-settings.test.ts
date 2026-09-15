import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { createDb, capabilityGrants, guilds, sessions } from "@management-bot/db";
import { createCallerFactory, type GuildMembership } from "@management-bot/dashboard-access";
import { CAPABILITIES } from "@management-bot/shared";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { guildSettingsRouter } from "./guild-settings.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required to run this test");

const { db, close } = createDb(databaseUrl);
const guildId1 = `test-guild-1-${randomUUID()}`;
const guildId2 = `test-guild-2-${randomUUID()}`;

afterAll(async () => {
  await db.delete(guilds).where(eq(guilds.id, guildId1));
  await db.delete(guilds).where(eq(guilds.id, guildId2));
  await close();
});

beforeEach(async () => {
  await db.delete(sessions).where(eq(sessions.id, "session-1"));
  await db.delete(guilds).where(eq(guilds.id, guildId1));
  await db.delete(guilds).where(eq(guilds.id, guildId2));
  await db.insert(guilds).values([
    { id: guildId1, name: "guild-1" },
    { id: guildId2, name: "guild-2" },
  ]);
  await db.insert(sessions).values({
    id: "session-1",
    discordUserId: "user-1",
    discordUsername: "user-1-name",
    encryptedAccessToken: "test-access-token",
    encryptedRefreshToken: "test-refresh-token",
    expiresAt: new Date(Date.now() + 60_000),
  });
});

const createCaller = createCallerFactory(guildSettingsRouter);

type GuildMembershipResolver = (guildId: string, discordUserId: string) => Promise<GuildMembership | null>;

function buildContext(overrides: { getGuildMembership: GuildMembershipResolver }) {
  return {
    db,
    sessionId: "session-1",
    discordClientId: "test-client-id",
    getGuildMembership: overrides.getGuildMembership,
    getGuildChannels: async () => [],
    getAllGuildChannels: async () => [],
    verifyGuildChannel: async () => false,
    getGuildMemberNames: async () => new Map<string, string>(),
    getBotPermissions: async () => 0n,
    getGuildRoles: async () => [],
    getGuildAccessStatus: async () => "ok" as const,
    verifyGuildRole: async () => true,
    getGuildMembersPage: async () => ({ members: [], nextAfter: undefined }),
    isGuildMember: async () => true,
    listMyGuilds: async () => [
      { id: guildId1, name: "guild-1", isManaged: false },
      { id: guildId2, name: "guild-2", isManaged: false },
    ],
  };
}

async function grant(guildId: string, targetType: "user" | "role", targetId: string, capabilities: number): Promise<void> {
  await db.insert(capabilityGrants).values({ id: randomUUID(), guildId, targetType, targetId, capabilities });
}

describe("guildSettingsRouter.listMyGuilds", () => {
  test("非在籍(membershipなし)のguildはcanViewLogs: falseになる", async () => {
    const caller = createCaller(buildContext({ getGuildMembership: async () => null }));

    const result = await caller.listMyGuilds();

    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: guildId1, canViewLogs: false }),
        expect.objectContaining({ id: guildId2, canViewLogs: false }),
      ]),
    );
  });

  test("在籍しているがcapability grantが何もないguildはcanViewLogs: falseになる", async () => {
    const caller = createCaller(
      buildContext({ getGuildMembership: async () => ({ isOwner: false, roleIds: [] }) }),
    );

    const result = await caller.listMyGuilds();

    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: guildId1, canViewLogs: false }),
        expect.objectContaining({ id: guildId2, canViewLogs: false }),
      ]),
    );
  });

  test("本人へのcapability grantがあるguildのみcanViewLogs: trueになる", async () => {
    await grant(guildId1, "user", "user-1", CAPABILITIES.VIEW_LOGS);
    const caller = createCaller(
      buildContext({ getGuildMembership: async () => ({ isOwner: false, roleIds: [] }) }),
    );

    const result = await caller.listMyGuilds();

    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: guildId1, canViewLogs: true }),
        expect.objectContaining({ id: guildId2, canViewLogs: false }),
      ]),
    );
  });

  test("@everyoneロール(roleId===guildId)へのgrantでもcanViewLogs: trueになる", async () => {
    await grant(guildId1, "role", guildId1, CAPABILITIES.VIEW_LOGS);
    const caller = createCaller(
      buildContext({ getGuildMembership: async () => ({ isOwner: false, roleIds: [] }) }),
    );

    const result = await caller.listMyGuilds();

    expect(result).toEqual(expect.arrayContaining([expect.objectContaining({ id: guildId1, canViewLogs: true })]));
  });

  test("VIEW_LOGSを含まないcapability(MANAGE_ACCESSのみ等)しか持たない場合はcanViewLogs: falseになる(issue #263 codexレビュー対応)", async () => {
    await grant(guildId1, "user", "user-1", CAPABILITIES.MANAGE_ACCESS);
    const caller = createCaller(
      buildContext({ getGuildMembership: async () => ({ isOwner: false, roleIds: [] }) }),
    );

    const result = await caller.listMyGuilds();

    expect(result).toEqual(expect.arrayContaining([expect.objectContaining({ id: guildId1, canViewLogs: false })]));
  });

  test("オーナーは常にcanViewLogs: trueになる", async () => {
    const caller = createCaller(
      buildContext({ getGuildMembership: async () => ({ isOwner: true, roleIds: [] }) }),
    );

    const result = await caller.listMyGuilds();

    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: guildId1, canViewLogs: true }),
        expect.objectContaining({ id: guildId2, canViewLogs: true }),
      ]),
    );
  });
});
