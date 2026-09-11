import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { capabilityGrants, createDb, guilds, moderationThresholds, moderationWhitelist, sessions } from "@management-bot/db";
import { CAPABILITIES } from "@management-bot/shared";
import { createCallerFactory, type GuildAccessStatus, type GuildMembership, type MemberPage, type RoleOption } from "@management-bot/dashboard-access";
import { eq } from "drizzle-orm";
import { moderationRouter } from "./index.js";
import { MODERATION_REQUIRED_PERMISSIONS } from "../discord/required-permissions.js";

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
});

const createCaller = createCallerFactory(moderationRouter);

type GuildMembershipResolver = (guildId: string, discordUserId: string) => Promise<GuildMembership | null>;

function memberOf(...guildIds: string[]): GuildMembershipResolver {
  return async (guildId) => (guildIds.includes(guildId) ? { isOwner: false, roleIds: [] } : null);
}

const rolesOf = (...options: RoleOption[]) => async (): Promise<RoleOption[]> => options;
const membersPageOf = (page: MemberPage = { members: [], nextAfter: undefined }) => async (): Promise<MemberPage> => page;

function buildContext(
  overrides: {
    getGuildMembership?: GuildMembershipResolver;
    isGuildMember?: (guildId: string, userId: string) => Promise<boolean>;
    getGuildRoles?: () => Promise<RoleOption[]>;
    getGuildAccessStatus?: () => Promise<GuildAccessStatus>;
    verifyGuildRole?: (guildId: string, roleId: string) => Promise<boolean>;
    getGuildMembersPage?: () => Promise<MemberPage>;
    getBotPermissions?: () => Promise<bigint>;
  } = {},
) {
  return {
    db,
    sessionId: "session-1",
    discordClientId: "test-client-id",
    getGuildMembership: overrides.getGuildMembership ?? memberOf(guildId),
    getGuildChannels: async () => [],
    getAllGuildChannels: async () => [],
    verifyGuildChannel: async () => false,
    getGuildMemberNames: async () => new Map<string, string>(),
    getBotPermissions: overrides.getBotPermissions ?? (async () => 0n),
    getGuildRoles: overrides.getGuildRoles ?? rolesOf(),
    getGuildAccessStatus: overrides.getGuildAccessStatus ?? (async () => "ok" as const),
    verifyGuildRole: overrides.verifyGuildRole ?? (async () => true),
    getGuildMembersPage: overrides.getGuildMembersPage ?? membersPageOf(),
    isGuildMember: overrides.isGuildMember ?? (async () => true),
    listMyGuilds: async () => [],
  };
}

async function grant(capabilities: number): Promise<void> {
  await db.insert(capabilityGrants).values({ id: randomUUID(), guildId, targetType: "user", targetId: "user-1", capabilities });
}

/** expect(promise).rejects.toThrow()はmutation呼び出しでbun:testがハングすることがあるため、try/catchで代替する。 */
async function captureRejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    return undefined;
  } catch (e) {
    return e;
  }
}

describe("moderationRouter.listThresholds / setThreshold", () => {
  test("MANAGE_MODERATIONを持たない場合はFORBIDDEN", async () => {
    const caller = createCaller(buildContext());
    const error = await captureRejection(caller.listThresholds({ guildId }));
    expect(error).toBeDefined();
  });

  test("setThresholdで作成した設定がlistThresholdsに反映される", async () => {
    await grant(CAPABILITIES.MANAGE_MODERATION);
    const caller = createCaller(buildContext());

    await caller.setThreshold({ guildId, violationType: "flood", preset: "medium", enabled: true });
    const result = await caller.listThresholds({ guildId });

    expect(result).toEqual([{ violationType: "flood", preset: "medium", enabled: true }]);
  });

  test("既存のviolationTypeへの再setThresholdは上書きする", async () => {
    await grant(CAPABILITIES.MANAGE_MODERATION);
    await db.insert(moderationThresholds).values({ guildId, violationType: "flood", preset: "weak", enabled: false });
    const caller = createCaller(buildContext());

    await caller.setThreshold({ guildId, violationType: "flood", preset: "strong", enabled: true });
    const result = await caller.listThresholds({ guildId });

    expect(result).toEqual([{ violationType: "flood", preset: "strong", enabled: true }]);
  });
});

describe("moderationRouter.listWhitelist / addToWhitelist / removeFromWhitelist", () => {
  test("追加した対象がlistWhitelistに反映され、削除すると消える", async () => {
    await grant(CAPABILITIES.MANAGE_MODERATION);
    const caller = createCaller(buildContext());
    const userId = `u-${randomUUID()}`;

    await caller.addToWhitelist({ guildId, targetType: "user", targetId: userId });
    expect(await caller.listWhitelist({ guildId })).toEqual([{ targetType: "user", targetId: userId }]);

    await caller.removeFromWhitelist({ guildId, targetType: "user", targetId: userId });
    expect(await caller.listWhitelist({ guildId })).toEqual([]);
  });

  test("在籍していないuserの追加はBAD_REQUEST", async () => {
    await grant(CAPABILITIES.MANAGE_MODERATION);
    const caller = createCaller(buildContext({ isGuildMember: async () => false }));

    const error = await captureRejection(
      caller.addToWhitelist({ guildId, targetType: "user", targetId: `u-${randomUUID()}` }),
    );

    expect(error).toBeDefined();
    expect(await db.select().from(moderationWhitelist).where(eq(moderationWhitelist.guildId, guildId))).toHaveLength(0);
  });

  test("実在しないroleの追加はBAD_REQUEST(表示用getGuildRolesではなくverifyGuildRoleで検証する)", async () => {
    await grant(CAPABILITIES.MANAGE_MODERATION);
    const caller = createCaller(buildContext({ verifyGuildRole: async () => false }));

    const error = await captureRejection(
      caller.addToWhitelist({ guildId, targetType: "role", targetId: `r-${randomUUID()}` }),
    );

    expect(error).toBeDefined();
  });

  test("@everyoneロール(targetId===guildId)の追加はverifyGuildRoleの結果によらず許可する", async () => {
    await grant(CAPABILITIES.MANAGE_MODERATION);
    const caller = createCaller(buildContext({ verifyGuildRole: async () => false }));

    await caller.addToWhitelist({ guildId, targetType: "role", targetId: guildId });

    expect(await caller.listWhitelist({ guildId })).toEqual([{ targetType: "role", targetId: guildId }]);
  });
});

describe("moderationRouter.getRequiredPermissionStatus", () => {
  test("必要権限を満たす場合はreauthorizeUrlがnull", async () => {
    await grant(CAPABILITIES.MANAGE_MODERATION);
    const caller = createCaller(buildContext({ getBotPermissions: async () => MODERATION_REQUIRED_PERMISSIONS }));

    const result = await caller.getRequiredPermissionStatus({ guildId });

    expect(result.hasRequiredPermissions).toBe(true);
    expect(result.reauthorizeUrl).toBeNull();
  });

  test("権限が不足している場合はreauthorizeUrlを返す", async () => {
    await grant(CAPABILITIES.MANAGE_MODERATION);
    const caller = createCaller(buildContext({ getBotPermissions: async () => 0n }));

    const result = await caller.getRequiredPermissionStatus({ guildId });

    expect(result.hasRequiredPermissions).toBe(false);
    expect(result.reauthorizeUrl).toContain("test-client-id");
  });
});
