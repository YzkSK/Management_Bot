import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import {
  createDb,
  type Db,
  guilds,
  moderationEscalationState,
  moderationThresholds,
  moderationWhitelist,
} from "@management-bot/db";
import type { ModerationActionRecordedEvent } from "@management-bot/shared";
import { eq } from "drizzle-orm";
import { Redis } from "ioredis";
import { detectAndEscalate, type IncomingMessage, SYSTEM_MODERATOR_ID } from "./detect-and-escalate.js";

const REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";

async function isRedisAvailable(): Promise<boolean> {
  const probe = new Redis(REDIS_URL, { retryStrategy: () => null, lazyConnect: true });
  try {
    await probe.connect();
    return true;
  } catch {
    return false;
  } finally {
    probe.disconnect();
  }
}

function message(overrides: Partial<IncomingMessage> & Pick<IncomingMessage, "guildId" | "userId">): IncomingMessage {
  return {
    messageId: randomUUID(),
    content: `msg-${randomUUID()}`,
    createdAt: new Date(),
    roleIds: [],
    ...overrides,
  };
}

describe.skipIf(!(await isRedisAvailable()))("detectAndEscalate", () => {
  let db: Db;
  let close: () => Promise<void>;
  const redis = new Redis(REDIS_URL);
  const guildId = `test-guild-${randomUUID()}`;

  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error("DATABASE_URL is required");
    ({ db, close } = createDb(databaseUrl));
    await db.insert(guilds).values({ id: guildId, name: "Test Guild" });
  });

  afterAll(async () => {
    await db.delete(guilds).where(eq(guilds.id, guildId));
    await close();
    redis.disconnect();
  });

  afterEach(async () => {
    await db.delete(moderationThresholds).where(eq(moderationThresholds.guildId, guildId));
    await db.delete(moderationWhitelist).where(eq(moderationWhitelist.guildId, guildId));
    await db.delete(moderationEscalationState).where(eq(moderationEscalationState.guildId, guildId));
  });

  function fakeEventBus() {
    const published: ModerationActionRecordedEvent[] = [];
    return { published, publish: async (event: ModerationActionRecordedEvent) => void published.push(event) };
  }

  test("検知種別が何も有効でなければ何も起きない", async () => {
    const eventBus = fakeEventBus();
    const result = await detectAndEscalate(
      { db, redis, eventBus },
      message({ guildId, userId: `u-${randomUUID()}` }),
    );
    expect(result).toEqual([]);
    expect(eventBus.published).toEqual([]);
  });

  test("ホワイトリスト対象ユーザーは連投してもstrikeCountが増加しない", async () => {
    const userId = `u-${randomUUID()}`;
    await db.insert(moderationThresholds).values({ guildId, violationType: "flood", preset: "strong", enabled: true });
    await db.insert(moderationWhitelist).values({ guildId, targetType: "user", targetId: userId });

    const eventBus = fakeEventBus();
    for (let i = 0; i < 5; i++) {
      await detectAndEscalate({ db, redis, eventBus }, message({ guildId, userId }));
    }

    expect(eventBus.published).toEqual([]);
    const rows = await db
      .select()
      .from(moderationEscalationState)
      .where(eq(moderationEscalationState.userId, userId));
    expect(rows).toEqual([]);
  });

  test("連投がstrong presetの頻度閾値に達するとstrikeCountが増加しアクションがpublishされる", async () => {
    const userId = `u-${randomUUID()}`;
    // strong preset: windowSeconds=8, messageThreshold=3, 1件目でescalationSteps[1]=messageDelete
    await db.insert(moderationThresholds).values({ guildId, violationType: "flood", preset: "strong", enabled: true });

    const eventBus = fakeEventBus();
    const now = new Date();
    let lastResult: Awaited<ReturnType<typeof detectAndEscalate>> = [];
    for (let i = 0; i < 3; i++) {
      lastResult = await detectAndEscalate(
        { db, redis, eventBus },
        message({ guildId, userId, createdAt: new Date(now.getTime() + i * 1000) }),
      );
    }

    expect(lastResult).toEqual([
      { violationType: "flood", strikeCount: 1, actionType: "messageDelete", caseId: expect.any(String) },
    ]);
    expect(eventBus.published).toHaveLength(1);
    expect(eventBus.published[0]).toMatchObject({
      type: "moderation.action.recorded",
      guildId,
      targetUserId: userId,
      moderatorId: SYSTEM_MODERATOR_ID,
      action: "create",
      actionType: "messageDelete",
    });

    const [row] = await db
      .select()
      .from(moderationEscalationState)
      .where(eq(moderationEscalationState.userId, userId));
    expect(row?.strikeCount).toBe(1);
  });
});
