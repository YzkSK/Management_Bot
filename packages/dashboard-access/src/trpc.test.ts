import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { createDb, capabilityGrants, guilds, sessions } from "@management-bot/db";
import { CAPABILITIES } from "@management-bot/shared";
import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  protectedProcedure,
  requireCapability,
  router,
  createCallerFactory,
  type GuildMembership,
} from "./trpc.ts";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required to run this test");

const { db, close } = createDb(databaseUrl);
const testId = randomUUID();
const guildId1 = `guild-1-${testId}`;
const guildId2 = `guild-2-${testId}`;
const guildIds = [guildId1, guildId2];
const sessionId = `session-1-${testId}`;
const grantId = `grant-1-${testId}`;

async function cleanup(): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
  await db.delete(capabilityGrants).where(eq(capabilityGrants.id, grantId));
  await db.delete(guilds).where(inArray(guilds.id, guildIds));
}

afterAll(async () => {
  await cleanup();
  await close();
});

beforeEach(async () => {
  await cleanup();
  await db.insert(guilds).values([
    { id: guildId1, name: "guild 1" },
    { id: guildId2, name: "guild 2" },
  ]);
  await db.insert(sessions).values({
    id: sessionId,
    discordUserId: "user-1",
    encryptedAccessToken: "test-access-token",
    encryptedRefreshToken: "test-refresh-token",
    expiresAt: new Date(Date.now() + 60_000),
  });
});

const testRouter = router({
  viewActivity: protectedProcedure
    .input(z.object({ guildId: z.string() }))
    .use(requireCapability(CAPABILITIES.VIEW_ACTIVITY))
    .query(() => "ok"),
});

const createCaller = createCallerFactory(testRouter);

function memberOf(...guildIds: string[]) {
  return async (guildId: string): Promise<GuildMembership | null> =>
    guildIds.includes(guildId) ? { isOwner: false, roleIds: [] } : null;
}

async function captureError(promise: Promise<unknown>): Promise<TRPCError> {
  try {
    await promise;
  } catch (e) {
    return e as TRPCError;
  }
  throw new Error("expected promise to reject");
}

describe("protectedProcedure", () => {
  test("有効なセッションがなければUNAUTHORIZEDを投げる", async () => {
    const caller = createCaller({
      db,
      sessionId: "nonexistent",
      getGuildMembership: memberOf(guildId1),
    });

    const error = await captureError(caller.viewActivity({ guildId: guildId1 }));

    expect(error.code).toBe("UNAUTHORIZED");
  });
});

describe("requireCapability / assertGuildScope", () => {
  test("該当ギルドでcapabilityを持たないユーザーはFORBIDDENを投げる(他ギルドのデータにアクセスできない)", async () => {
    await db.insert(capabilityGrants).values({
      id: grantId,
      guildId: guildId2,
      targetType: "user",
      targetId: "user-1",
      capabilities: CAPABILITIES.VIEW_ACTIVITY,
    });

    const caller = createCaller({
      db,
      sessionId,
      getGuildMembership: memberOf(guildId1, guildId2),
    });

    const error = await captureError(caller.viewActivity({ guildId: guildId1 }));

    expect(error.code).toBe("FORBIDDEN");
  });

  test("該当ギルドに在籍していないユーザーは、grantが残っていてもFORBIDDENを投げる(脱退・キック後のアクセス拒否)", async () => {
    await db.insert(capabilityGrants).values({
      id: grantId,
      guildId: guildId1,
      targetType: "user",
      targetId: "user-1",
      capabilities: CAPABILITIES.VIEW_ACTIVITY,
    });

    const caller = createCaller({
      db,
      sessionId,
      getGuildMembership: memberOf(), // どのギルドにも在籍していない
    });

    const error = await captureError(caller.viewActivity({ guildId: guildId1 }));

    expect(error.code).toBe("FORBIDDEN");
  });

  test("該当ギルドでcapabilityを持つユーザーは許可される", async () => {
    await db.insert(capabilityGrants).values({
      id: grantId,
      guildId: guildId1,
      targetType: "user",
      targetId: "user-1",
      capabilities: CAPABILITIES.VIEW_ACTIVITY,
    });

    const caller = createCaller({
      db,
      sessionId,
      getGuildMembership: memberOf(guildId1),
    });

    const result = await caller.viewActivity({ guildId: guildId1 });

    expect(result).toBe("ok");
  });

  test("在籍しているギルドオーナーはgrantなしでも許可される", async () => {
    const caller = createCaller({
      db,
      sessionId,
      getGuildMembership: async (guildId: string) =>
        guildId === guildId1 ? { isOwner: true, roleIds: [] } : null,
    });

    const result = await caller.viewActivity({ guildId: guildId1 });

    expect(result).toBe("ok");
  });

  test("@everyoneロール(targetId===guildId)へのgrantはroleIdsに含めなくても適用される", async () => {
    await db.insert(capabilityGrants).values({
      id: grantId,
      guildId: guildId1,
      targetType: "role",
      targetId: guildId1,
      capabilities: CAPABILITIES.VIEW_ACTIVITY,
    });

    const caller = createCaller({
      db,
      sessionId,
      getGuildMembership: memberOf(guildId1),
    });

    const result = await caller.viewActivity({ guildId: guildId1 });

    expect(result).toBe("ok");
  });
});

describe("requireCapability(不正なcapability引数)", () => {
  test("0を渡すと構築時にエラーになる", () => {
    expect(() => requireCapability(0)).toThrow();
  });

  test("未知のビットを渡すと構築時にエラーになる", () => {
    expect(() => requireCapability(1 << 20)).toThrow();
  });
});
