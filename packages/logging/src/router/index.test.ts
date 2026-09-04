import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { createDb, capabilityGrants, guilds, logEntries, sessions } from "@management-bot/db";
import { CAPABILITIES } from "@management-bot/shared";
import { createCallerFactory, type GuildMembership } from "@management-bot/dashboard-access";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { loggingRouter } from "./index.js";

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
      action: "create",
      content: "secret message",
    },
    createdAt: new Date("2026-08-31T00:00:00.000Z"),
  });
});

const createCaller = createCallerFactory(loggingRouter);

function memberOf(...guildIds: string[]) {
  return async (guildId: string): Promise<GuildMembership | null> =>
    guildIds.includes(guildId) ? { isOwner: false, roleIds: [] } : null;
}

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
    });

    const result = await caller.listLogEntries({ guildId, limit: 50 });

    expect(result.entries).toHaveLength(1);
    expect((result.entries[0]?.entry as { content?: string }).content).toBeUndefined();
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
    });

    const result = await caller.listLogEntries({ guildId, limit: 50 });

    expect((result.entries[0]?.entry as { content?: string }).content).toBe("secret message");
  });

  test("VIEW_LOGSを持たない場合はFORBIDDEN", async () => {
    const caller = createCaller({
      db,
      sessionId: "session-1",
      getGuildMembership: memberOf(guildId),
    });

    await expect(caller.listLogEntries({ guildId, limit: 50 })).rejects.toThrow();
  });
});
