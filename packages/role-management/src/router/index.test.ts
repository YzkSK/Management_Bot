import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { capabilityGrants, createDb, guilds, sessions } from "@management-bot/db";
import { CAPABILITIES } from "@management-bot/shared";
import { createCallerFactory, type GuildRoleList } from "@management-bot/dashboard-access";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { roleManagementRouter } from "./index.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required to run this test");

const { db, close } = createDb(databaseUrl);
const guildId = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

afterAll(async () => {
  await db.delete(guilds).where(eq(guilds.id, guildId));
  await close();
});

beforeEach(async () => {
  await db.delete(sessions).where(eq(sessions.id, "session-roles"));
  await db.delete(guilds).where(eq(guilds.id, guildId));
  await db.insert(guilds).values({ id: guildId, name: "guild" });
  await db.insert(sessions).values({
    id: "session-roles",
    discordUserId: "user-1",
    discordUsername: "user-1-name",
    encryptedAccessToken: "test-access-token",
    encryptedRefreshToken: "test-refresh-token",
    expiresAt: new Date(Date.now() + 60_000),
  });
});

const createCaller = createCallerFactory(roleManagementRouter);

function buildContext(getGuildRoleList: () => Promise<GuildRoleList | null> = async () => null) {
  return {
    db,
    sessionId: "session-roles",
    discordClientId: "test-client-id",
    getGuildMembership: async () => ({ isOwner: false, roleIds: [] }),
    getGuildChannels: async () => [],
    getAllGuildChannels: async () => [],
    verifyGuildChannel: async () => false,
    getGuildMemberNames: async () => new Map<string, string>(),
    getBotPermissions: async () => 0n,
    getGuildRoles: async () => [],
    getGuildVoiceChannelOptions: async () => [],
    getGuildCategoryOptions: async () => [],
    getGuildAccessStatus: async () => "ok" as const,
    getGuildOwnerId: async () => null,
    getGuildRoleList,
    verifyGuildRole: async () => true,
    getGuildMembersPage: async () => ({ members: [], nextAfter: undefined }),
    readRedisHash: async () => ({}),
    isGuildMember: async () => true,
    listMyGuilds: async () => [],
  };
}

async function grant(capabilities: number): Promise<void> {
  await db.insert(capabilityGrants).values({ id: randomUUID(), guildId, targetType: "user", targetId: "user-1", capabilities });
}

/** expect(promise).rejects.toThrow()はbun:testがハングすることがあるため、try/catchで代替する(他routerテストと同じ対策)。 */
async function captureRejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    return undefined;
  } catch (e) {
    return e;
  }
}

describe("roleManagementRouter.list", () => {
  test("VIEW_ROLESを持たない場合はFORBIDDEN", async () => {
    const caller = createCaller(buildContext());
    const error = await captureRejection(caller.list({ guildId }));
    expect(error instanceof TRPCError && error.code).toBe("FORBIDDEN");
  });

  test("ロールをDiscordのロール順で返し、メンバー数の有無を伝える", async () => {
    await grant(CAPABILITIES.VIEW_ROLES);
    const caller = createCaller(
      buildContext(async () => ({
        roles: [
          { id: guildId, name: "@everyone", color: 0, position: 0, permissions: "1024", managed: false, botId: null },
          { id: "20", name: "mod", color: 255, position: 2, permissions: "8", managed: false, botId: null },
        ],
        memberCounts: { "20": 3 },
        botRoleIds: ["30"],
      })),
    );

    const result = await caller.list({ guildId });

    expect(result.memberCountsAvailable).toBe(true);
    expect(result.roles.map((r) => [r.id, r.memberCount])).toEqual([
      ["20", 3],
      [guildId, null],
    ]);
  });

  test("Bot未参加等で取得できなければ空一覧を返す", async () => {
    await grant(CAPABILITIES.VIEW_ROLES);
    const caller = createCaller(buildContext());

    expect(await caller.list({ guildId })).toEqual({ roles: [], memberCountsAvailable: false });
  });
});
