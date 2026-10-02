import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { activityHourly, capabilityGrants, createDb, guilds, sessions } from "@management-bot/db";
import { CAPABILITIES } from "@management-bot/shared";
import { createCallerFactory } from "@management-bot/dashboard-access";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { activityRouter } from "./index.js";
import { VOICE_OCCUPIED_USER_ID } from "../application/index.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required to run this test");

const { db, close } = createDb(databaseUrl);
const guildId = `test-guild-${randomUUID()}`;
const from = "2026-09-27T15:00:00.000Z";
const to = "2026-09-29T12:00:00.000Z";

afterAll(async () => {
  await db.delete(guilds).where(eq(guilds.id, guildId));
  await close();
});

beforeEach(async () => {
  await db.delete(sessions).where(eq(sessions.id, "session-activity"));
  await db.delete(guilds).where(eq(guilds.id, guildId));
  await db.insert(guilds).values({ id: guildId, name: "guild" });
  await db.insert(sessions).values({
    id: "session-activity",
    discordUserId: "user-1",
    discordUsername: "user-1-name",
    encryptedAccessToken: "test-access-token",
    encryptedRefreshToken: "test-refresh-token",
    expiresAt: new Date(Date.now() + 60_000),
  });
  await db.insert(activityHourly).values([
    { guildId, userId: "a", hour: new Date("2026-09-28T14:00:00Z"), messageCount: 3, voiceSeconds: 600 },
    { guildId, userId: "b", hour: new Date("2026-09-29T01:00:00Z"), messageCount: 10, voiceSeconds: 0 },
    // サーバー全体のVC時間(誰かがVCにいた時間)の行(issue #508)。
    { guildId, userId: VOICE_OCCUPIED_USER_ID, hour: new Date("2026-09-28T14:00:00Z"), messageCount: 0, voiceSeconds: 600 },
  ]);
});

const createCaller = createCallerFactory(activityRouter);

function buildContext(
  getGuildMemberNames: () => Promise<Map<string, string>> = async () => new Map(),
  readRedisHash: (key: string) => Promise<Record<string, string>> = async () => ({}),
) {
  return {
    db,
    sessionId: "session-activity",
    discordClientId: "test-client-id",
    getGuildMembership: async () => ({ isOwner: false, roleIds: [] }),
    getGuildChannels: async () => [],
    getAllGuildChannels: async () => [],
    verifyGuildChannel: async () => false,
    getGuildMemberNames,
    getBotPermissions: async () => 0n,
    getGuildRoles: async () => [],
    getGuildVoiceChannelOptions: async () => [],
    getGuildCategoryOptions: async () => [],
    getGuildAccessStatus: async () => "ok" as const,
    getGuildOwnerId: async () => null,
    verifyGuildRole: async () => true,
    getGuildMembersPage: async () => ({
      members: [{ id: "a", name: "Alice", avatarUrl: "https://cdn.discordapp.com/avatars/a/x.png" }],
      nextAfter: undefined,
    }),
    readRedisHash,
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

describe("activityRouter", () => {
  test("VIEW_ACTIVITYを持たない場合はFORBIDDEN", async () => {
    const caller = createCaller(buildContext());
    const error = await captureRejection(caller.serverSummary({ guildId, from, to, granularity: "day" }));
    expect(error instanceof TRPCError && error.code).toBe("FORBIDDEN");
  });

  test("toがfrom以前ならBAD_REQUEST", async () => {
    await grant(CAPABILITIES.VIEW_ACTIVITY);
    const caller = createCaller(buildContext());
    const error = await captureRejection(caller.serverSummary({ guildId, from: to, to: from, granularity: "day" }));
    expect(error instanceof TRPCError && error.code).toBe("BAD_REQUEST");
  });

  test("serverSummaryは期間の合計と推移を返す", async () => {
    await grant(CAPABILITIES.VIEW_ACTIVITY);
    const caller = createCaller(buildContext());
    const result = await caller.serverSummary({ guildId, from, to, granularity: "day" });
    expect(result.totals).toEqual({ messageCount: 13, voiceSeconds: 600, activeMembers: 2 });
  });

  test("memberRankingはメンバー名を解決し、解決できないIDはnullにする", async () => {
    await grant(CAPABILITIES.VIEW_ACTIVITY);
    const caller = createCaller(buildContext(async () => new Map([["b", "Bob"]])));
    const result = await caller.memberRanking({ guildId, from, to, sort: "messages", page: 0 });
    expect(result.rows.map((r) => [r.userId, r.name, r.avatarUrl])).toEqual([
      ["b", "Bob", null],
      ["a", null, "https://cdn.discordapp.com/avatars/a/x.png"],
    ]);
    expect(result.pageSize).toBe(20);
    expect(result.total).toBe(2);
  });

  test("memberDetailとlistMemberOptionsを返す", async () => {
    await grant(CAPABILITIES.VIEW_ACTIVITY);
    const caller = createCaller(buildContext());
    const detail = await caller.memberDetail({ guildId, userId: "a", from, to });
    expect(detail.totals).toEqual({ messageCount: 3, voiceSeconds: 600 });
    const options = await caller.listMemberOptions({ guildId });
    expect(options.members.map((m) => [m.id, m.name])).toEqual([["a", "Alice"]]);
  });
});

describe("activeVoice", () => {
  test("VIEW_ACTIVITYがあればRedisの在室状況をチャンネル別に返す", async () => {
    await grant(CAPABILITIES.VIEW_ACTIVITY);
    const keys: string[] = [];
    const caller = createCaller(
      buildContext(undefined, async (key) => {
        keys.push(key);
        return {
          u1: JSON.stringify({
            channelId: "c1",
            channelName: "雑談VC",
            afk: false,
            name: "Alice",
            avatarUrl: null,
            joinedAt: "2026-09-29T10:00:00.000Z",
            selfMute: false,
            selfDeaf: false,
            serverMute: true,
            serverDeaf: false,
            streaming: false,
            video: false,
          }),
        };
      }),
    );
    const channels = await caller.activeVoice({ guildId });
    expect(keys).toEqual([`activity:voice:${guildId}`]);
    expect(channels[0]?.members[0]).toMatchObject({ userId: "u1", serverMute: true, counting: false });
  });

  test("VIEW_ACTIVITYが無ければFORBIDDEN", async () => {
    const caller = createCaller(buildContext());
    const error = await captureRejection(caller.activeVoice({ guildId }));
    expect(error).toBeInstanceOf(TRPCError);
    expect(error instanceof TRPCError && error.code).toBe("FORBIDDEN");
  });
});
