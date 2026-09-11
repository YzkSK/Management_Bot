import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, test } from "bun:test";
import { Redis } from "ioredis";
import { claimAndPushMessage } from "./message-buffer.js";

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

describe.skipIf(!(await isRedisAvailable()))("claimAndPushMessage", () => {
  const redis = new Redis(REDIS_URL);
  const guildId = `g-${randomUUID()}`;
  const userId = `u-${randomUUID()}`;

  afterEach(async () => {
    const keys = await redis.keys(`moderation:*:${guildId}:*`);
    if (keys.length > 0) await redis.del(...keys);
  });

  test("新しい順(先頭が最新)でバッファを返す", async () => {
    await claimAndPushMessage(
      redis,
      guildId,
      userId,
      { messageId: "m1", content: "hello", createdAt: new Date("2026-01-01T00:00:00.000Z") },
      3600,
      60,
    );
    const buffer = await claimAndPushMessage(
      redis,
      guildId,
      userId,
      { messageId: "m2", content: "world", createdAt: new Date("2026-01-01T00:00:01.000Z") },
      3600,
      60,
    );

    expect(buffer?.map((m) => m.messageId)).toEqual(["m2", "m1"]);
    expect(buffer?.[0]?.createdAt).toEqual(new Date("2026-01-01T00:00:01.000Z"));
  });

  test("TTLをwindowSecondsで設定する", async () => {
    await claimAndPushMessage(
      redis,
      guildId,
      userId,
      { messageId: `m-${randomUUID()}`, content: "hello", createdAt: new Date() },
      3600,
      60,
    );
    const ttl = await redis.ttl(`moderation:flood:${guildId}:${userId}`);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60);
  });

  test("同一messageIdの2回目呼び出しはnullを返し、バッファに触れない", async () => {
    const messageId = `m-${randomUUID()}`;
    const first = await claimAndPushMessage(
      redis,
      guildId,
      userId,
      { messageId, content: "hello", createdAt: new Date() },
      3600,
      60,
    );
    const second = await claimAndPushMessage(
      redis,
      guildId,
      userId,
      { messageId, content: "hello", createdAt: new Date() },
      3600,
      60,
    );

    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(first).toHaveLength(1);
  });
});
