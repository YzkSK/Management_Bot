import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { createDb, capabilityGrants, guilds, sessions } from "@management-bot/db";
import { CAPABILITIES } from "@management-bot/shared";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { capabilityGrantsRouter } from "./router.js";
import {
  createCallerFactory,
  type GuildAccessStatus,
  type GuildMembership,
  type MemberPage,
  type RoleOption,
} from "./trpc.js";

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

const createCaller = createCallerFactory(capabilityGrantsRouter);

type GuildMembershipResolver = (guildId: string, discordUserId: string) => Promise<GuildMembership | null>;

/** 指定guildIdへの呼び出しは常にmembershipを返す(discordUserIdは問わない)、単純なfixture。 */
function memberOf(...guildIds: string[]): GuildMembershipResolver {
  return async (guildId) => (guildIds.includes(guildId) ? { isOwner: false, roleIds: [] } : null);
}

const rolesOf = (...options: RoleOption[]) => async (): Promise<RoleOption[]> => options;

const membersPageOf = () => async (): Promise<MemberPage> => ({ members: [], nextAfter: undefined });

function buildContext(
  overrides: {
    getGuildMembership?: GuildMembershipResolver;
    /** targetIdの実在検証(isGuildMember)。デフォルトは常にtrue(在籍している)を返す。 */
    isGuildMember?: (guildId: string, userId: string) => Promise<boolean>;
    /** 表示用のrole一覧(listRoleOptions)。デフォルトは空配列。 */
    getGuildRoles?: () => Promise<RoleOption[]>;
    /** listRoleOptions等がBot権限不足を判別するための状態(issue #214)。デフォルトは"ok"。 */
    getGuildAccessStatus?: () => Promise<GuildAccessStatus>;
    /**
     * targetIdの実在検証(verifyGuildRole)。表示用のgetGuildRolesとは独立に指定できる
     * (実装がgetGuildRoles(キャッシュ経由)を誤って検証に使い回す退行を検出するため、
     * デフォルトはgetGuildRolesに委譲しない)。
     */
    verifyGuildRole?: (guildId: string, roleId: string) => Promise<boolean>;
    getGuildMemberNames?: (guildId: string, userIds: readonly string[]) => Promise<ReadonlyMap<string, string>>;
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
    getGuildMemberNames: overrides.getGuildMemberNames ?? (async () => new Map<string, string>()),
    getBotPermissions: async () => 0n,
    getGuildRoles: overrides.getGuildRoles ?? rolesOf(),
    getGuildAccessStatus: overrides.getGuildAccessStatus ?? (async () => "ok" as const),
    verifyGuildRole: overrides.verifyGuildRole ?? (async () => true),
    getGuildMembersPage: membersPageOf(),
    isGuildMember: overrides.isGuildMember ?? (async () => true),
    listMyGuilds: async () => [],
  };
}

async function grant(targetType: "user" | "role", targetId: string, capabilities: number): Promise<void> {
  await db.insert(capabilityGrants).values({ id: randomUUID(), guildId, targetType, targetId, capabilities });
}

/**
 * expect(promise).rejects.toThrow()はmutation呼び出しに対してbun:testがハングする
 * 既知の相性問題があるため、try/catchで代替する(packages/logging/src/router/index.test.tsと同様)。
 */
async function captureRejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    return undefined;
  } catch (e) {
    return e;
  }
}

describe("capabilityGrantsRouter.listCapabilityGrants", () => {
  test("MANAGE_ACCESSを持たない場合はFORBIDDEN", async () => {
    const caller = createCaller(buildContext());

    await expect(caller.listCapabilityGrants({ guildId })).rejects.toThrow();
  });

  test("MANAGE_ACCESSを持つ場合はgrant一覧を返す", async () => {
    await grant("user", "user-1", CAPABILITIES.MANAGE_ACCESS);
    await grant("user", "u2", CAPABILITIES.VIEW_LOGS);
    const caller = createCaller(buildContext());

    const result = await caller.listCapabilityGrants({ guildId });

    expect(result).toHaveLength(2);
  });
});

describe("capabilityGrantsRouter.getMyCapabilities", () => {
  test("直接付与のcapabilitiesを返す", async () => {
    await grant("user", "user-1", CAPABILITIES.MANAGE_ACCESS | CAPABILITIES.VIEW_LOGS);
    const caller = createCaller(buildContext());

    const result = await caller.getMyCapabilities({ guildId });

    expect(result.capabilities).toBe(CAPABILITIES.MANAGE_ACCESS | CAPABILITIES.VIEW_LOGS);
  });

  test("role経由(@everyone含む)のcapabilitiesもORで反映する", async () => {
    await grant("user", "user-1", CAPABILITIES.MANAGE_ACCESS);
    await grant("role", guildId, CAPABILITIES.VIEW_LOGS);
    const caller = createCaller(
      buildContext({ getGuildMembership: async () => ({ isOwner: false, roleIds: [guildId] }) }),
    );

    const result = await caller.getMyCapabilities({ guildId });

    expect(result.capabilities).toBe(CAPABILITIES.MANAGE_ACCESS | CAPABILITIES.VIEW_LOGS);
  });

  test("MANAGE_ACCESSを持たない場合はFORBIDDEN", async () => {
    const caller = createCaller(buildContext());

    await expect(caller.getMyCapabilities({ guildId })).rejects.toThrow();
  });
});

describe("capabilityGrantsRouter.grantCapabilities", () => {
  test("自分が持つcapabilityの部分集合はtargetへ付与できる", async () => {
    await grant("user", "user-1", CAPABILITIES.MANAGE_ACCESS | CAPABILITIES.VIEW_LOGS);
    const caller = createCaller(buildContext());

    await caller.grantCapabilities({
      guildId,
      targetType: "user",
      targetId: "u2",
      capabilities: CAPABILITIES.VIEW_LOGS,
    });

    const rows = await db.select().from(capabilityGrants).where(eq(capabilityGrants.targetId, "u2"));
    expect(rows[0]?.capabilities).toBe(CAPABILITIES.VIEW_LOGS);
  });

  test("自分が持たないcapabilityを含む付与はFORBIDDEN(昇格防止)", async () => {
    await grant("user", "user-1", CAPABILITIES.MANAGE_ACCESS);
    const caller = createCaller(buildContext());

    const error = await captureRejection(
      caller.grantCapabilities({
        guildId,
        targetType: "user",
        targetId: "u2",
        capabilities: CAPABILITIES.MANAGE_MODERATION,
      }),
    );

    expect(error).toBeDefined();
    const rows = await db.select().from(capabilityGrants).where(eq(capabilityGrants.targetId, "u2"));
    expect(rows).toHaveLength(0);
  });

  test("未定義ビットを含むcapabilitiesはBAD_REQUEST", async () => {
    await grant("user", "user-1", CAPABILITIES.MANAGE_ACCESS);
    const caller = createCaller(buildContext());

    const error = await captureRejection(
      caller.grantCapabilities({
        guildId,
        targetType: "user",
        targetId: "u2",
        capabilities: 1 << 30,
      }),
    );

    expect(error).toBeDefined();
  });

  test("MANAGE_ACCESSを持たない場合はFORBIDDEN", async () => {
    const caller = createCaller(buildContext());

    const error = await captureRejection(
      caller.grantCapabilities({
        guildId,
        targetType: "user",
        targetId: "u2",
        capabilities: CAPABILITIES.VIEW_LOGS,
      }),
    );

    expect(error).toBeDefined();
  });

  test("既存grantに自分が持たないcapabilityが含まれる場合はFORBIDDEN(置換による意図しない剥奪を防止)", async () => {
    await grant("user", "user-1", CAPABILITIES.MANAGE_ACCESS | CAPABILITIES.VIEW_LOGS);
    await grant("user", "u2", CAPABILITIES.MANAGE_MODERATION | CAPABILITIES.VIEW_LOGS);
    const caller = createCaller(buildContext());

    const error = await captureRejection(
      caller.grantCapabilities({
        guildId,
        targetType: "user",
        targetId: "u2",
        capabilities: CAPABILITIES.VIEW_LOGS,
      }),
    );

    expect(error).toBeDefined();
    const rows = await db.select().from(capabilityGrants).where(eq(capabilityGrants.targetId, "u2"));
    expect(rows[0]?.capabilities).toBe(CAPABILITIES.MANAGE_MODERATION | CAPABILITIES.VIEW_LOGS);
  });

  test("capabilities=0はBAD_REQUEST(剥奪はrevokeCapabilityGrantを使う)", async () => {
    await grant("user", "user-1", CAPABILITIES.MANAGE_ACCESS);
    const caller = createCaller(buildContext());

    const error = await captureRejection(
      caller.grantCapabilities({ guildId, targetType: "user", targetId: "u2", capabilities: 0 }),
    );

    expect(error).toBeDefined();
  });

  test("roleへの付与はverifyGuildRoleに実在するroleのみ許可する(表示用getGuildRolesは使わない)", async () => {
    await grant("user", "user-1", CAPABILITIES.MANAGE_ACCESS);
    let getGuildRolesCalls = 0;
    let verifyGuildRoleCalls = 0;
    const caller = createCaller(
      buildContext({
        // 表示用一覧には実在させ、検証専用verifyGuildRoleがgetGuildRolesに委譲していないことを
        // 確認する(委譲していれば以下のgrantは誤って成功してしまう)。
        getGuildRoles: async () => {
          getGuildRolesCalls++;
          return [{ id: "unknown-role", name: "Admin" }];
        },
        verifyGuildRole: async (actualGuildId, roleId) => {
          verifyGuildRoleCalls++;
          return actualGuildId === guildId && roleId === "r1";
        },
      }),
    );

    const error = await captureRejection(
      caller.grantCapabilities({
        guildId,
        targetType: "role",
        targetId: "unknown-role",
        capabilities: CAPABILITIES.MANAGE_ACCESS,
      }),
    );

    expect(error).toBeDefined();
    expect(verifyGuildRoleCalls).toBe(1);
    expect(getGuildRolesCalls).toBe(0);
    const rows = await db.select().from(capabilityGrants).where(eq(capabilityGrants.targetId, "unknown-role"));
    expect(rows).toHaveLength(0);
  });

  test("verifyGuildRoleがtrueを返すroleへの付与は成功する", async () => {
    await grant("user", "user-1", CAPABILITIES.MANAGE_ACCESS);
    const caller = createCaller(buildContext({ verifyGuildRole: async () => true }));

    await caller.grantCapabilities({
      guildId,
      targetType: "role",
      targetId: "r1",
      capabilities: CAPABILITIES.MANAGE_ACCESS,
    });

    const rows = await db.select().from(capabilityGrants).where(eq(capabilityGrants.targetId, "r1"));
    expect(rows[0]?.capabilities).toBe(CAPABILITIES.MANAGE_ACCESS);
  });

  test("@everyoneロール(targetId===guildId)への付与はverifyGuildRoleの結果によらず許可する", async () => {
    await grant("user", "user-1", CAPABILITIES.MANAGE_ACCESS | CAPABILITIES.VIEW_LOGS);
    const caller = createCaller(buildContext({ verifyGuildRole: async () => false }));

    await caller.grantCapabilities({
      guildId,
      targetType: "role",
      targetId: guildId,
      capabilities: CAPABILITIES.VIEW_LOGS,
    });

    const rows = await db.select().from(capabilityGrants).where(eq(capabilityGrants.targetId, guildId));
    expect(rows[0]?.capabilities).toBe(CAPABILITIES.VIEW_LOGS);
  });

  test("在籍していないuserへの付与はBAD_REQUEST(isGuildMemberにtargetIdが渡ること、操作者自身の在籍確認とは独立であることを確認)", async () => {
    await grant("user", "user-1", CAPABILITIES.MANAGE_ACCESS);
    const isGuildMemberCalls: Array<{ guildId: string; userId: string }> = [];
    const caller = createCaller(
      buildContext({
        isGuildMember: async (calledGuildId, userId) => {
          isGuildMemberCalls.push({ guildId: calledGuildId, userId });
          return userId !== "not-a-member";
        },
      }),
    );

    const error = await captureRejection(
      caller.grantCapabilities({
        guildId,
        targetType: "user",
        targetId: "not-a-member",
        capabilities: CAPABILITIES.MANAGE_ACCESS,
      }),
    );

    expect(error).toBeDefined();
    expect(isGuildMemberCalls).toEqual([{ guildId, userId: "not-a-member" }]);
    const rows = await db.select().from(capabilityGrants).where(eq(capabilityGrants.targetId, "not-a-member"));
    expect(rows).toHaveLength(0);
  });
});

describe("capabilityGrantsRouter.revokeCapabilityGrant", () => {
  test("自分が持つcapabilityの範囲内のgrantは剥奪できる", async () => {
    await grant("user", "user-1", CAPABILITIES.MANAGE_ACCESS | CAPABILITIES.VIEW_LOGS);
    await grant("user", "u2", CAPABILITIES.VIEW_LOGS);
    const caller = createCaller(buildContext());

    await caller.revokeCapabilityGrant({ guildId, targetType: "user", targetId: "u2" });

    const rows = await db.select().from(capabilityGrants).where(eq(capabilityGrants.targetId, "u2"));
    expect(rows).toHaveLength(0);
  });

  test("自分が持たないcapabilityを含むgrantの剥奪はFORBIDDEN(部分剥奪も不可)", async () => {
    await grant("user", "user-1", CAPABILITIES.MANAGE_ACCESS);
    await grant("user", "u2", CAPABILITIES.MANAGE_ACCESS | CAPABILITIES.MANAGE_MODERATION);
    const caller = createCaller(buildContext());

    const error = await captureRejection(
      caller.revokeCapabilityGrant({ guildId, targetType: "user", targetId: "u2" }),
    );

    expect(error).toBeDefined();
    const rows = await db.select().from(capabilityGrants).where(eq(capabilityGrants.targetId, "u2"));
    expect(rows).toHaveLength(1);
  });

  test("未付与のtargetを剥奪しても何も起きない", async () => {
    await grant("user", "user-1", CAPABILITIES.MANAGE_ACCESS);
    const caller = createCaller(buildContext());

    await caller.revokeCapabilityGrant({ guildId, targetType: "user", targetId: "u2" });
  });
});

describe("capabilityGrantsRouter.listRoleOptions / listMemberOptions", () => {
  test("listRoleOptionsはctx.getGuildRolesの結果をそのまま返す", async () => {
    await grant("user", "user-1", CAPABILITIES.MANAGE_ACCESS);
    const caller = createCaller(buildContext({ getGuildRoles: rolesOf({ id: guildId, name: "@everyone" }) }));

    const result = await caller.listRoleOptions({ guildId });

    expect(result).toEqual({ roles: [{ id: guildId, name: "@everyone" }], accessStatus: "ok" });
  });

  test("listRoleOptionsはctx.getGuildAccessStatusの結果もそのまま返す(issue #214)", async () => {
    await grant("user", "user-1", CAPABILITIES.MANAGE_ACCESS);
    const caller = createCaller(buildContext({ getGuildAccessStatus: async () => "forbidden" }));

    const result = await caller.listRoleOptions({ guildId });

    expect(result).toEqual({ roles: [], accessStatus: "forbidden" });
  });

  test("listMemberOptionsはMANAGE_ACCESSを要求する", async () => {
    const caller = createCaller(buildContext());

    await expect(caller.listMemberOptions({ guildId })).rejects.toThrow();
  });
});

describe("capabilityGrantsRouter.resolveTargetUserNames", () => {
  test("ctx.getGuildMemberNamesの結果をplain objectとして返す", async () => {
    await grant("user", "user-1", CAPABILITIES.MANAGE_ACCESS);
    const caller = createCaller(
      buildContext({ getGuildMemberNames: async () => new Map([["u1", "user-one"]]) }),
    );

    const result = await caller.resolveTargetUserNames({ guildId, userIds: ["u1"] });

    expect(result).toEqual({ u1: "user-one" });
  });

  test("userIdsが空配列ならgetGuildMemberNamesを呼ばず空objectを返す", async () => {
    await grant("user", "user-1", CAPABILITIES.MANAGE_ACCESS);
    let called = false;
    const caller = createCaller(
      buildContext({
        getGuildMemberNames: async () => {
          called = true;
          return new Map();
        },
      }),
    );

    const result = await caller.resolveTargetUserNames({ guildId, userIds: [] });

    expect(result).toEqual({});
    expect(called).toBe(false);
  });

  test("MANAGE_ACCESSを持たない場合はFORBIDDEN", async () => {
    const caller = createCaller(buildContext());

    await expect(caller.resolveTargetUserNames({ guildId, userIds: [] })).rejects.toThrow();
  });
});
