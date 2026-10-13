import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import {
  capabilityGrants,
  createDb,
  guilds,
  listenForTempVoiceChannelAction,
  sessions,
  tempVoiceDenyProtectedRoles,
  type TempVoiceChannelActionNotification,
} from "@management-bot/db";
import { CAPABILITIES } from "@management-bot/shared";
import { createCallerFactory, type ChannelOption, type RoleOption } from "@management-bot/dashboard-access";
import { eq } from "drizzle-orm";
import { tempVoiceRouter } from "./index.js";
import { insertTempVoiceChannel, upsertPermissionOverride } from "../application/index.js";

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
    getAllGuildChannels?: () => Promise<ChannelOption[]>;
    getGuildMemberNames?: () => Promise<Map<string, string>>;
    readRedisHash?: (key: string) => Promise<Record<string, string>>;
  } = {},
) {
  return {
    db,
    sessionId: "session-1",
    discordClientId: "test-client-id",
    getGuildMembership: async () => ({ isOwner: false, roleIds: [] }),
    getGuildChannels: async () => [],
    getAllGuildChannels: overrides.getAllGuildChannels ?? (async () => []),
    verifyGuildChannel: async () => false,
    getGuildMemberNames: overrides.getGuildMemberNames ?? (async () => new Map<string, string>()),
    getBotPermissions: async () => 0n,
    getGuildRoles: overrides.getGuildRoles ?? (async () => [{ id: "role-1", name: "モデレーター" }]),
    getGuildVoiceChannelOptions: overrides.getGuildVoiceChannelOptions ?? (async () => [{ id: "vc-1", name: "ロビー" }]),
    getGuildCategoryOptions: overrides.getGuildCategoryOptions ?? (async () => [{ id: "cat-1", name: "一時VC" }]),
    getGuildAccessStatus: async () => "ok" as const,
    getGuildOwnerId: async () => null,
    verifyGuildRole: async () => true,
    getGuildMembersPage: async () => ({ members: [{ id: "user-2", name: "Bob" }], nextAfter: undefined }),
    readRedisHash: overrides.readRedisHash ?? (async () => ({})),
    isGuildMember: async (_guildId: string, userId: string) => userId !== "ghost",
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
  test("VIEW_TEMP_VOICEのみでは設定を閲覧できずFORBIDDEN", async () => {
    await grant(CAPABILITIES.VIEW_TEMP_VOICE);
    const caller = createCaller(buildContext());
    const error = await captureRejection(caller.getConfig({ guildId }));
    expect(error).toBeDefined();
  });

  test("未設定ギルドはnullを返す", async () => {
    await grant(CAPABILITIES.MANAGE_TEMP_VOICE);
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

describe("tempVoiceRouter.clearConfig", () => {
  test("MANAGE_TEMP_VOICEを持たない場合はFORBIDDEN", async () => {
    const caller = createCaller(buildContext());
    const error = await captureRejection(caller.clearConfig({ guildId }));
    expect(error).toBeDefined();
  });

  test("createChannelId/categoryIdをnullに戻し、共通設定は保持する", async () => {
    await grant(CAPABILITIES.MANAGE_TEMP_VOICE | CAPABILITIES.VIEW_TEMP_VOICE);
    const caller = createCaller(buildContext());
    await caller.setConfig({
      guildId,
      createChannelId: "vc-1",
      categoryId: "cat-1",
      nameTemplate: "custom-{username}",
      defaultUserLimit: 5,
    });

    await caller.clearConfig({ guildId });

    const config = await caller.getConfig({ guildId });
    expect(config?.createChannelId).toBeNull();
    expect(config?.categoryId).toBeNull();
    expect(config?.nameTemplate).toBe("custom-{username}");
    expect(config?.defaultUserLimit).toBe(5);
  });
});

describe("tempVoiceRouter.getDenyProtectedRoles / setDenyProtectedRoles", () => {
  test("VIEW_TEMP_VOICEのみでは拒否禁止ロールを閲覧できずFORBIDDEN", async () => {
    await grant(CAPABILITIES.VIEW_TEMP_VOICE);
    const caller = createCaller(buildContext());
    const error = await captureRejection(caller.getDenyProtectedRoles({ guildId }));
    expect(error).toBeDefined();
  });

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
  test("状態が無い一時VCは在室者なし・設定値nullで返す", async () => {
    await grant(CAPABILITIES.VIEW_TEMP_VOICE);
    const channelId = `channel-${randomUUID()}`;
    await insertTempVoiceChannel(db, { channelId, guildId, controlChannelId: "control-1", ownerId: "owner-1" });
    const caller = createCaller(buildContext());

    const result = await caller.listActiveChannels({ guildId });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      channelId,
      guildId,
      ownerId: "owner-1",
      userLimit: null,
      bitrate: null,
      isLocked: false,
      isHidden: false,
      members: [],
    });
  });

  test("Redisの状態をchannelIdで突き合わせて返す(不正なエントリは無視)", async () => {
    await grant(CAPABILITIES.VIEW_TEMP_VOICE);
    const channelId = `channel-${randomUUID()}`;
    const otherId = `channel-${randomUUID()}`;
    await insertTempVoiceChannel(db, { channelId, guildId, controlChannelId: "control-1", ownerId: "owner-1" });
    await insertTempVoiceChannel(db, { channelId: otherId, guildId, controlChannelId: "control-2", ownerId: "owner-2" });
    const member = {
      userId: "owner-1",
      name: "YoMi",
      avatarUrl: null,
      selfMute: true,
      serverMute: false,
      selfDeaf: false,
      serverDeaf: false,
      streaming: false,
      video: false,
    };
    const caller = createCaller(
      buildContext({
        readRedisHash: async (key) => {
          expect(key).toBe(`temp-voice:state:${guildId}`);
          return {
            [channelId]: JSON.stringify({ userLimit: 5, bitrate: 64000, isLocked: true, isHidden: true, members: [member] }),
            [otherId]: "broken",
          };
        },
      }),
    );

    const result = await caller.listActiveChannels({ guildId });

    const matched = result.find((r) => r.channelId === channelId);
    expect(matched).toMatchObject({ userLimit: 5, bitrate: 64000, isLocked: true, isHidden: true, members: [member] });
    expect(result.find((r) => r.channelId === otherId)).toMatchObject({ userLimit: null, members: [] });
  });

  test("チャンネル名・オーナー名を付けて返す(解決できないものは未設定)", async () => {
    await grant(CAPABILITIES.VIEW_TEMP_VOICE);
    const channelId = `channel-${randomUUID()}`;
    await insertTempVoiceChannel(db, { channelId, guildId, controlChannelId: "control-1", ownerId: "owner-1" });
    const caller = createCaller(
      buildContext({
        getAllGuildChannels: async () => [{ id: channelId, name: "YoMiのVC" }],
        getGuildMemberNames: async () => new Map([["owner-1", "YoMi"]]),
      }),
    );

    const result = await caller.listActiveChannels({ guildId });

    expect(result[0]).toMatchObject({ channelName: "YoMiのVC", ownerName: "YoMi" });
  });

  test("VIEW_TEMP_VOICEが無いメンバーには自分がオーナーのVCだけを返す", async () => {
    const ownId = `channel-${randomUUID()}`;
    await insertTempVoiceChannel(db, { channelId: ownId, guildId, controlChannelId: "control-1", ownerId: "user-1" });
    await insertTempVoiceChannel(db, { channelId: `channel-${randomUUID()}`, guildId, controlChannelId: "control-2", ownerId: "owner-2" });
    const caller = createCaller(buildContext());

    const result = await caller.listActiveChannels({ guildId });

    expect(result.map((r) => r.channelId)).toEqual([ownId]);
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

describe("tempVoiceRouter.updateChannel / getChannelOverrides / listOverrideTargetOptions (#649)", () => {
  const stateWith = (channelId: string, userIds: string[]) => async () => ({
    [channelId]: JSON.stringify({
      userLimit: 0,
      bitrate: 64000,
      isLocked: false,
      isHidden: false,
      members: userIds.map((userId) => ({
        userId,
        name: userId,
        avatarUrl: null,
        selfMute: false,
        serverMute: false,
        selfDeaf: false,
        serverDeaf: false,
        streaming: false,
        video: false,
      })),
    }),
  });

  async function insertOwned(ownerId: string): Promise<string> {
    const channelId = `channel-${randomUUID()}`;
    await insertTempVoiceChannel(db, { channelId, guildId, controlChannelId: "control-1", ownerId });
    return channelId;
  }

  test("オーナー本人はrenameでき、pg_notifyでbotへ届く(Dashboard→notifyの複合)", async () => {
    const channelId = await insertOwned("user-1");
    const received: TempVoiceChannelActionNotification[] = [];
    const listener = listenForTempVoiceChannelAction(databaseUrl, (n) => received.push(n));
    await listener.ready;
    try {
      await createCaller(buildContext()).updateChannel({ guildId, channelId, action: { type: "rename", name: "新しい名前" } });
      for (let i = 0; i < 50 && received.length === 0; i++) await new Promise((r) => setTimeout(r, 20));
    } finally {
      await listener.close();
    }
    expect(received).toEqual([{ guildId, channelId, executorId: "user-1", action: { type: "rename", name: "新しい名前" } }]);
  });

  test("他人のVCはFORBIDDEN、MANAGE_TEMP_VOICE保持者は他人のVCも変更できる", async () => {
    const channelId = await insertOwned("owner-2");
    const caller = createCaller(buildContext());
    const error = await captureRejection(caller.updateChannel({ guildId, channelId, action: { type: "setLocked", locked: true } }));
    expect(error).toMatchObject({ code: "FORBIDDEN" });

    await grant(CAPABILITIES.MANAGE_TEMP_VOICE | CAPABILITIES.VIEW_TEMP_VOICE);
    expect(await caller.updateChannel({ guildId, channelId, action: { type: "setLocked", locked: true } })).toBeUndefined();
  });

  test("一時VCでないchannelIdや別ギルドのVCはBAD_REQUEST", async () => {
    const caller = createCaller(buildContext());
    const error = await captureRejection(caller.updateChannel({ guildId, channelId: "missing", action: { type: "setHidden", hidden: true } }));
    expect(error).toMatchObject({ code: "BAD_REQUEST" });
  });

  test("不正な入力値はBAD_REQUEST", async () => {
    const channelId = await insertOwned("user-1");
    const caller = createCaller(buildContext());
    for (const action of [
      { type: "rename", name: "   " },
      { type: "userLimit", value: 100 },
      { type: "bitrate", kbps: 7 },
      { type: "bitrate", kbps: 200 },
    ] as const) {
      const error = await captureRejection(caller.updateChannel({ guildId, channelId, action }));
      expect(error).toMatchObject({ code: "BAD_REQUEST" });
    }
  });

  test("permit/denyは実在するロール/メンバーのみ、拒否禁止ロールとeveryoneは拒否する", async () => {
    const channelId = await insertOwned("user-1");
    await db.insert(tempVoiceDenyProtectedRoles).values({ guildId, roleId: "role-1" });
    const caller = createCaller(buildContext());
    const reject = (action: Parameters<typeof caller.updateChannel>[0]["action"]) =>
      captureRejection(caller.updateChannel({ guildId, channelId, action }));

    expect(await reject({ type: "deny", targetType: "role", targetId: "role-1" })).toMatchObject({ code: "BAD_REQUEST" });
    expect(await reject({ type: "permit", targetType: "role", targetId: "unknown-role" })).toMatchObject({ code: "BAD_REQUEST" });
    expect(await reject({ type: "permit", targetType: "role", targetId: guildId })).toMatchObject({ code: "BAD_REQUEST" });
    expect(await reject({ type: "permit", targetType: "user", targetId: "ghost" })).toMatchObject({ code: "BAD_REQUEST" });
    // 保護ロールでも許可は可能、実在メンバーの拒否も可能。
    expect(await caller.updateChannel({ guildId, channelId, action: { type: "permit", targetType: "role", targetId: "role-1" } })).toBeUndefined();
    expect(await caller.updateChannel({ guildId, channelId, action: { type: "deny", targetType: "user", targetId: "user-2" } })).toBeUndefined();
  });

  test("transferOwnerは在室中の別メンバーのみ", async () => {
    const channelId = await insertOwned("user-1");
    const caller = createCaller(buildContext({ readRedisHash: stateWith(channelId, ["user-1", "user-2"]) }));
    const reject = (userId: string) => captureRejection(caller.updateChannel({ guildId, channelId, action: { type: "transferOwner", userId } }));

    expect(await reject("not-in-channel")).toMatchObject({ code: "BAD_REQUEST" });
    expect(await reject("user-1")).toMatchObject({ code: "BAD_REQUEST" });
    expect(await caller.updateChannel({ guildId, channelId, action: { type: "transferOwner", userId: "user-2" } })).toBeUndefined();

    await insertOwned("user-2");
    expect(await reject("user-2")).toMatchObject({ code: "BAD_REQUEST" });
  });

  test("getChannelOverridesは名前を付けて返し、他人のVCはFORBIDDEN", async () => {
    const channelId = await insertOwned("user-1");
    await upsertPermissionOverride(db, { channelId, targetType: "user", targetId: "user-2", state: "allow" });
    await upsertPermissionOverride(db, { channelId, targetType: "role", targetId: "role-1", state: "deny" });
    const caller = createCaller(buildContext({ getGuildMemberNames: async () => new Map([["user-2", "Bob"]]) }));

    const result = await caller.getChannelOverrides({ guildId, channelId });
    expect(result).toHaveLength(2);
    expect(result).toContainEqual({ targetType: "user", targetId: "user-2", state: "allow", name: "Bob" });
    expect(result).toContainEqual({ targetType: "role", targetId: "role-1", state: "deny", name: "モデレーター" });

    const otherId = await insertOwned("owner-3");
    expect(await captureRejection(caller.getChannelOverrides({ guildId, channelId: otherId }))).toMatchObject({ code: "FORBIDDEN" });
  });

  test("listOverrideTargetOptionsはメンバーとロール(@everyone除外)を返し、他人のVCはFORBIDDEN", async () => {
    const channelId = await insertOwned("user-1");
    const caller = createCaller(
      buildContext({ getGuildRoles: async () => [{ id: guildId, name: "@everyone" }, { id: "role-1", name: "モデレーター" }] }),
    );

    expect(await caller.listOverrideTargetOptions({ guildId, channelId })).toEqual({
      members: [{ id: "user-2", name: "Bob" }],
      nextAfter: undefined,
      roles: [{ id: "role-1", name: "モデレーター" }],
    });
    const otherId = await insertOwned("owner-3");
    expect(await captureRejection(caller.listOverrideTargetOptions({ guildId, channelId: otherId }))).toMatchObject({ code: "FORBIDDEN" });
  });

  test("listActiveChannelsはisMine/canEditを返す", async () => {
    await grant(CAPABILITIES.VIEW_TEMP_VOICE);
    const mine = await insertOwned("user-1");
    const other = await insertOwned("owner-2");
    const result = await createCaller(buildContext()).listActiveChannels({ guildId });
    expect(result.find((r) => r.channelId === mine)).toMatchObject({ isMine: true, canEdit: true });
    expect(result.find((r) => r.channelId === other)).toMatchObject({ isMine: false, canEdit: false });
  });
});
