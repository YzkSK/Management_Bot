import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createCallerFactory, router, type GuildMembership } from "@management-bot/dashboard-access";
import { auditLogs, capabilityGrants, createDb, guilds, scheduledPosts, sessions } from "@management-bot/db";
import { CAPABILITIES } from "@management-bot/shared";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { scheduledPostRouter } from "./index.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required to run this test");

const { db, close } = createDb(databaseUrl);
const guildId = `test-guild-${randomUUID()}`;

const USERS = ["owner", "viewer", "manager", "member", "other", "outsider"] as const;
type User = (typeof USERS)[number];
const memberships: Record<User, GuildMembership | null> = {
  owner: { isOwner: true, roleIds: [] },
  viewer: { isOwner: false, roleIds: [] },
  manager: { isOwner: false, roleIds: [] },
  member: { isOwner: false, roleIds: [] },
  other: { isOwner: false, roleIds: [] },
  outsider: null,
};

const createCaller = createCallerFactory(router({ scheduledPost: scheduledPostRouter }));

function callerFor(user: User) {
  return createCaller({
    db,
    sessionId: `sess-${user}`,
    discordClientId: "test-client-id",
    getGuildMembership: async (g, userId) => (g === guildId ? (memberships[userId as User] ?? null) : null),
    getGuildChannels: async () => [],
    getAllGuildChannels: async () => [],
    verifyGuildChannel: async () => false,
    getGuildMemberNames: async (_g, ids) => new Map(ids.map((id) => [id, `${id}-nick`])),
    getBotPermissions: async () => 0n,
    getGuildRoles: async () => [],
    getGuildAccessStatus: async () => "ok" as const,
    getGuildOwnerId: async () => "owner",
    verifyGuildRole: async () => true,
    getGuildMembersPage: async () => ({ members: [], nextAfter: undefined }),
    readRedisHash: async () => ({}),
    isGuildMember: async () => true,
    listMyGuilds: async () => [],
    getGuildVoiceChannelOptions: async () => [],
    getGuildCategoryOptions: async () => [],
    getMyAvatarUrl: async () => null,
  }).scheduledPost;
}

async function insertPost(authorId: string, status = "pending"): Promise<string> {
  const id = randomUUID();
  await db.insert(scheduledPosts).values({
    id,
    guildId,
    channelId: "c1",
    authorId,
    content: `post of ${authorId}`,
    scheduledAt: new Date(Date.now() + 3_600_000),
    status,
  });
  return id;
}

async function codeOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    return undefined;
  } catch (e) {
    return typeof e === "object" && e !== null && "code" in e ? e.code : e;
  }
}

async function auditCount(): Promise<number> {
  return (await db.select().from(auditLogs).where(eq(auditLogs.guildId, guildId))).length;
}

beforeAll(async () => {
  await db.insert(guilds).values({ id: guildId, name: "guild" });
  await db.insert(sessions).values(
    USERS.map((u) => ({
      id: `sess-${u}`,
      discordUserId: u,
      discordUsername: `${u}-name`,
      encryptedAccessToken: "t",
      encryptedRefreshToken: "r",
      expiresAt: new Date(Date.now() + 600_000),
    })),
  );
  await db.insert(capabilityGrants).values([
    { id: randomUUID(), guildId, targetType: "user", targetId: "viewer", capabilities: CAPABILITIES.VIEW_SCHEDULED_POSTS },
    {
      id: randomUUID(),
      guildId,
      targetType: "user",
      targetId: "manager",
      capabilities: CAPABILITIES.VIEW_SCHEDULED_POSTS | CAPABILITIES.MANAGE_SCHEDULED_POSTS,
    },
  ]);
});

afterAll(async () => {
  for (const u of USERS) await db.delete(sessions).where(eq(sessions.id, `sess-${u}`));
  // audit_logsは追記専用のため削除しない(一意なguildIdを使う)。
  await db.delete(guilds).where(eq(guilds.id, guildId));
  await close();
});

describe("scheduledPost.list", () => {
  test("閲覧権限なしのメンバーは自分の予約だけ、閲覧権限者・オーナーは全件、非在籍はFORBIDDEN", async () => {
    const mine = await insertPost("member");
    const theirs = await insertPost("other");

    const own = await callerFor("member").list({ guildId });
    expect(own.map((p) => p.id)).toEqual([mine]);
    expect(own.every((p) => p.isMine)).toBe(true);
    expect(own.map((p) => p.id)).not.toContain(theirs);

    for (const user of ["viewer", "manager", "owner"] as const) {
      const all = await callerFor(user).list({ guildId });
      expect(all.map((p) => p.id).sort()).toEqual([mine, theirs].sort());
    }
    expect((await callerFor("viewer").list({ guildId })).find((p) => p.id === mine)?.isMine).toBe(false);

    expect(await codeOf(callerFor("outsider").list({ guildId }))).toBe("FORBIDDEN");
  });
});

describe("scheduledPost.cancelOwn", () => {
  test("本人は投稿待ちを取り消せて、操作履歴は増えない", async () => {
    const id = await insertPost("member");
    const before = await auditCount();

    await callerFor("member").cancelOwn({ guildId, id });

    const [row] = await db.select().from(scheduledPosts).where(eq(scheduledPosts.id, id));
    expect(row?.status).toBe("cancelled");
    expect(row?.cancelledBy).toBe("author");
    expect(await auditCount()).toBe(before);
  });

  test("他人の予約はFORBIDDEN(管理権限があっても本人用procedureでは不可)、非在籍もFORBIDDEN", async () => {
    const id = await insertPost("other");
    expect(await codeOf(callerFor("member").cancelOwn({ guildId, id }))).toBe("FORBIDDEN");
    expect(await codeOf(callerFor("manager").cancelOwn({ guildId, id }))).toBe("FORBIDDEN");
    expect(await codeOf(callerFor("outsider").cancelOwn({ guildId, id }))).toBe("FORBIDDEN");
    const [row] = await db.select().from(scheduledPosts).where(eq(scheduledPosts.id, id));
    expect(row?.status).toBe("pending");
  });

  test("投稿待ち以外はCONFLICT", async () => {
    const id = await insertPost("member", "posted");
    expect(await codeOf(callerFor("member").cancelOwn({ guildId, id }))).toBe("CONFLICT");
  });
});
