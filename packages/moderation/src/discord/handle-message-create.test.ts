import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { createDb, type Db, guilds, moderationEscalationState, moderationThresholds } from "@management-bot/db";
import type { ModerationActionRecordedEvent } from "@management-bot/shared";
import { eq } from "drizzle-orm";
import { Redis } from "ioredis";
import type { Message } from "discord.js";
import { handleMessageCreate } from "./handle-message-create.js";

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

function fakeMessage(overrides: {
  guildId: string;
  userId: string;
  content: string;
  bot?: boolean;
  hasGuild?: boolean;
  hasMember?: boolean;
}) {
  const deleteFn = mock(() => Promise.resolve());
  const timeout = mock(() => Promise.resolve());
  const kick = mock(() => Promise.resolve());
  const ban = mock(() => Promise.resolve());
  return {
    author: { id: overrides.userId, bot: overrides.bot ?? false },
    guild: overrides.hasGuild === false ? null : { id: overrides.guildId },
    member: overrides.hasMember === false ? null : { roles: { cache: new Map() }, timeout, kick, ban },
    id: randomUUID(),
    content: overrides.content,
    createdAt: new Date(),
    delete: deleteFn,
    deleteFn,
    timeout,
    kick,
    ban,
  };
}

describe.skipIf(!(await isRedisAvailable()))("handleMessageCreate", () => {
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
    await db.delete(moderationEscalationState).where(eq(moderationEscalationState.guildId, guildId));
    const keys = await redis.keys(`moderation:*:${guildId}:*`);
    if (keys.length > 0) await redis.del(...keys);
  });

  function fakeEventBus() {
    const published: ModerationActionRecordedEvent[] = [];
    return { published, publish: async (event: ModerationActionRecordedEvent) => void published.push(event) };
  }

  test("botのメッセージは無視する", async () => {
    const eventBus = fakeEventBus();
    const message = fakeMessage({ guildId, userId: `u-${randomUUID()}`, content: "hi", bot: true });
    await handleMessageCreate({ db, redis, eventBus }, message as unknown as Message);
    expect(eventBus.published).toEqual([]);
  });

  test("guild/memberがないメッセージ(DM等)は無視する", async () => {
    const eventBus = fakeEventBus();
    const message = fakeMessage({ guildId, userId: `u-${randomUUID()}`, content: "hi", hasGuild: false });
    await handleMessageCreate({ db, redis, eventBus }, message as unknown as Message);
    expect(eventBus.published).toEqual([]);
  });

  test("連投でstrong presetの閾値に達するとmessageDeleteが実行される", async () => {
    const userId = `u-${randomUUID()}`;
    await db.insert(moderationThresholds).values({ guildId, violationType: "flood", preset: "strong", enabled: true });

    const eventBus = fakeEventBus();
    let last: ReturnType<typeof fakeMessage> | undefined;
    for (let i = 0; i < 3; i++) {
      last = fakeMessage({ guildId, userId, content: `msg-${i}` });
      await handleMessageCreate({ db, redis, eventBus }, last as unknown as Message);
    }

    expect(last?.deleteFn).toHaveBeenCalledTimes(1);
    expect(eventBus.published).toHaveLength(1);
  });

  test("flood/duplicate_contentが同時にヒットしても、実行される処罰は最も重い1件に集約される", async () => {
    const userId = `u-${randomUUID()}`;
    // flood: strong(windowSeconds=8, messageThreshold=3) / duplicate_content: strong(閾値0.85, strike1でmessageDelete)
    await db.insert(moderationThresholds).values([
      { guildId, violationType: "flood", preset: "strong", enabled: true },
      { guildId, violationType: "duplicate_content", preset: "strong", enabled: true },
    ]);

    const eventBus = fakeEventBus();
    const content = "spam spam spam";
    let last: ReturnType<typeof fakeMessage> | undefined;
    for (let i = 0; i < 3; i++) {
      last = fakeMessage({ guildId, userId, content });
      await handleMessageCreate({ db, redis, eventBus }, last as unknown as Message);
    }

    // 2件目: duplicate_content(strike1=messageDelete)のみヒット。
    // 3件目: flood(strike1=messageDelete)とduplicate_content(strike2=timeout)が同時にヒットし、
    // moderation.action.recordedは両方publishされるが、Discord側の実行はより重いtimeoutに集約され、
    // messageDeleteは実行されない。
    expect(eventBus.published).toHaveLength(3);
    expect(last?.timeout).toHaveBeenCalledTimes(1);
    expect(last?.deleteFn).not.toHaveBeenCalled();
  });
});
