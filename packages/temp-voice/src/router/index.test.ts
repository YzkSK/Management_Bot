import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { capabilityGrants, createDb, guilds, sessions } from "@management-bot/db";
import { CAPABILITIES } from "@management-bot/shared";
import { createCallerFactory, type ChannelOption, type RoleOption } from "@management-bot/dashboard-access";
import { eq } from "drizzle-orm";
import { tempVoiceRouter } from "./index.js";
import { insertTempVoiceChannel } from "../application/index.js";

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

const createCaller = createCallerFactory(tempVoiceRouter);

/** テストごとに実在するVC/カテゴリ/ロールを差し替えられるようにする(既定は#415 spec通りvc-1/cat-1/role-1)。 */
function buildContext(
  overrides: {
    getGuildVoiceChannelOptions?: () => Promise<ChannelOption[]>;
    getGuildCategoryOptions?: () => Promise<ChannelOption[]>;
    getGuildRoles?: () => Promise<RoleOption[]>;
  } = {},
) {
  return {
    db,
    sessionId: "session-1",
    discordClientId: "test-client-id",
    getGuildMembership: async () => ({ isOwner: false, roleIds: [] }),
    getGuildChannels: async () => [],
    getAllGuildChannels: async () => [],
    verifyGuildChannel: async () => false,
    getGuildMemberNames: async () => new Map<string, string>(),
    getBotPermissions: async () => 0n,
    getGuildRoles: overrides.getGuildRoles ?? (async () => [{ id: "role-1", name: "モデレーター" }]),
    getGuildVoiceChannelOptions: overrides.getGuildVoiceChannelOptions ?? (async () => [{ id: "vc-1", name: "ロビー" }]),
    getGuildCategoryOptions: overrides.getGuildCategoryOptions ?? (async () => [{ id: "cat-1", name: "一時VC" }]),
    getGuildAccessStatus: async () => "ok" as const,
    verifyGuildRole: async () => true,
    getGuildMembersPage: async () => ({ members: [], nextAfter: undefined }),
    isGuildMember: async () => true,
    listMyGuilds: async () => [],
  };
}

async function grant(capabilities: number): Promise<void> {
  await db.insert(capabilityGrants).values({ id: randomUUID(), guildId, targetType: "user", targetId: "user-1", capabilities });
}

/** expect(promise).rejects.toThrow()はmutation呼び出しでbun:testがハングすることがあるため、try/catchで代替する(moderationRouterテストと同じ対策)。 */
async function captureRejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    return undefined;
  } catch (e) {
    return e;
  }
}

describe("tempVoiceRouter.getConfig / setConfig", () => {
  test("VIEW_TEMP_VOICEを持たない場合はFORBIDDEN", async () => {
    const caller = createCaller(buildContext());
    const error = await captureRejection(caller.getConfig({ guildId }));
    expect(error).toBeDefined();
  });

  test("未設定ギルドはnullを返す", async () => {
    await grant(CAPABILITIES.VIEW_TEMP_VOICE);
    const caller = createCaller(buildContext());

    expect(await caller.getConfig({ guildId })).toBeNull();
  });

  test("実在するVC/カテゴリを指定すると保存される", async () => {
    await grant(CAPABILITIES.MANAGE_TEMP_VOICE | CAPABILITIES.VIEW_TEMP_VOICE);
    const caller = createCaller(buildContext());

    await caller.setConfig({ guildId, createChannelId: "vc-1", categoryId: "cat-1" });

    const config = await caller.getConfig({ guildId });
    expect(config?.createChannelId).toBe("vc-1");
    expect(config?.categoryId).toBe("cat-1");
  });

  test("実在しないVCのIDはBAD_REQUESTで拒否する", async () => {
    await grant(CAPABILITIES.MANAGE_TEMP_VOICE);
    const caller = createCaller(buildContext());

    const error = await captureRejection(caller.setConfig({ guildId, createChannelId: "unknown-vc" }));
    expect(error).toBeDefined();
  });

  test("categoryIdにVCのIDを渡すと種別不一致でBAD_REQUESTになる", async () => {
    await grant(CAPABILITIES.MANAGE_TEMP_VOICE);
    // getGuildCategoryOptionsはcat-1のみを実在カテゴリとして返す既定のまま、categoryIdにvc-1を渡す。
    const caller = createCaller(buildContext());

    const error = await captureRejection(caller.setConfig({ guildId, categoryId: "vc-1" }));
    expect(error).toBeDefined();
  });

  test("空文字のnameTemplateはBAD_REQUESTで拒否する", async () => {
    await grant(CAPABILITIES.MANAGE_TEMP_VOICE);
    const caller = createCaller(buildContext());

    const error = await captureRejection(caller.setConfig({ guildId, nameTemplate: "" }));
    expect(error).toBeDefined();
  });
});

describe("tempVoiceRouter.autoSetupConfig", () => {
  test("createChannelId/categoryIdが未設定のギルドでは受け付ける", async () => {
    await grant(CAPABILITIES.MANAGE_TEMP_VOICE);
    const caller = createCaller(buildContext());

    const result = await caller.autoSetupConfig({ guildId });
    expect(result).toBeUndefined();
  });

  test("設定済みギルドではBAD_REQUESTで拒否する", async () => {
    await grant(CAPABILITIES.MANAGE_TEMP_VOICE);
    const caller = createCaller(buildContext());
    await caller.setConfig({ guildId, createChannelId: "vc-1", categoryId: "cat-1" });

    const error = await captureRejection(caller.autoSetupConfig({ guildId }));
    expect(error).toBeDefined();
  });
});

describe("tempVoiceRouter.getDenyProtectedRoles / setDenyProtectedRoles", () => {
  test("実在しないロールIDはBAD_REQUESTで拒否する", async () => {
    await grant(CAPABILITIES.MANAGE_TEMP_VOICE);
    const caller = createCaller(buildContext());

    const error = await captureRejection(caller.setDenyProtectedRoles({ guildId, roleIds: ["unknown-role"] }));
    expect(error).toBeDefined();
  });

  test("実在するロールIDは全件置き換えで保存される", async () => {
    await grant(CAPABILITIES.MANAGE_TEMP_VOICE | CAPABILITIES.VIEW_TEMP_VOICE);
    const caller = createCaller(buildContext());

    await caller.setDenyProtectedRoles({ guildId, roleIds: ["role-1"] });

    expect(await caller.getDenyProtectedRoles({ guildId })).toEqual(["role-1"]);
  });
});

describe("tempVoiceRouter.listActiveChannels", () => {
  test("在室人数付きの一時VC一覧を返す", async () => {
    await grant(CAPABILITIES.VIEW_TEMP_VOICE);
    const channelId = `channel-${randomUUID()}`;
    await insertTempVoiceChannel(db, { channelId, guildId, controlChannelId: "control-1", ownerId: "owner-1" });
    const caller = createCaller(buildContext());

    const result = await caller.listActiveChannels({ guildId });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ channelId, guildId, ownerId: "owner-1", memberCount: 0 });
  });
});

describe("tempVoiceRouter.forceDelete", () => {
  test("存在しないchannelIdはBAD_REQUESTで拒否する", async () => {
    await grant(CAPABILITIES.MANAGE_TEMP_VOICE);
    const caller = createCaller(buildContext());

    const error = await captureRejection(caller.forceDelete({ guildId, channelId: "missing-channel" }));
    expect(error).toBeDefined();
  });

  test("別ギルドの実在するchannelIdを渡すとBAD_REQUESTで拒否する", async () => {
    await grant(CAPABILITIES.MANAGE_TEMP_VOICE);
    const otherGuildId = `test-guild-${randomUUID()}`;
    await db.insert(guilds).values({ id: otherGuildId, name: "other" });
    const otherChannelId = `channel-${randomUUID()}`;
    await insertTempVoiceChannel(db, { channelId: otherChannelId, guildId: otherGuildId, controlChannelId: "control-1", ownerId: "owner-1" });
    const caller = createCaller(buildContext());

    const error = await captureRejection(caller.forceDelete({ guildId, channelId: otherChannelId }));
    expect(error).toBeDefined();

    await db.delete(guilds).where(eq(guilds.id, otherGuildId));
  });

  test("同一ギルドの実在するchannelIdは受け付ける", async () => {
    await grant(CAPABILITIES.MANAGE_TEMP_VOICE);
    const channelId = `channel-${randomUUID()}`;
    await insertTempVoiceChannel(db, { channelId, guildId, controlChannelId: "control-1", ownerId: "owner-1" });
    const caller = createCaller(buildContext());

    const result = await caller.forceDelete({ guildId, channelId });
    expect(result).toBeUndefined();
  });
});

describe("tempVoiceRouter.listVoiceChannelOptions / listCategoryOptions / listRoleOptions", () => {
  test("listVoiceChannelOptionsはctx.getGuildVoiceChannelOptionsをそのまま返す", async () => {
    await grant(CAPABILITIES.MANAGE_TEMP_VOICE);
    const caller = createCaller(buildContext());

    expect(await caller.listVoiceChannelOptions({ guildId })).toEqual([{ id: "vc-1", name: "ロビー" }]);
  });

  test("listCategoryOptionsはctx.getGuildCategoryOptionsをそのまま返す", async () => {
    await grant(CAPABILITIES.MANAGE_TEMP_VOICE);
    const caller = createCaller(buildContext());

    expect(await caller.listCategoryOptions({ guildId })).toEqual([{ id: "cat-1", name: "一時VC" }]);
  });

  test("listRoleOptionsはctx.getGuildRolesをそのまま返す", async () => {
    await grant(CAPABILITIES.MANAGE_TEMP_VOICE);
    const caller = createCaller(buildContext());

    expect(await caller.listRoleOptions({ guildId })).toEqual([{ id: "role-1", name: "モデレーター" }]);
  });
});
