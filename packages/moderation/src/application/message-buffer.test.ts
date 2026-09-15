import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, test } from "bun:test";
import { Redis } from "ioredis";
import { pushAndReadBuffer } from "./message-buffer.js";

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

describe.skipIf(!(await isRedisAvailable()))("pushAndReadBuffer", () => {
  const redis = new Redis(REDIS_URL);
  const guildId = `g-${randomUUID()}`;
  const userId = `u-${randomUUID()}`;

  afterEach(async () => {
    await redis.del(`moderation:flood:${guildId}:${userId}`);
  });

  test("新しい順(先頭が最新)でバッファを返す", async () => {
    await pushAndReadBuffer(
      redis,
      guildId,
      userId,
      { messageId: "m1", content: "hello", createdAt: new Date("2026-01-01T00:00:00.000Z") },
      60,
    );
    const buffer = await pushAndReadBuffer(
      redis,
      guildId,
      userId,
      { messageId: "m2", content: "world", createdAt: new Date("2026-01-01T00:00:01.000Z") },
      60,
    );

    expect(buffer.map((m) => m.messageId)).toEqual(["m2", "m1"]);
    expect(buffer[0]?.createdAt).toEqual(new Date("2026-01-01T00:00:01.000Z"));
  });

  test("TTLをwindowSecondsで設定する", async () => {
    await pushAndReadBuffer(
      redis,
      guildId,
      userId,
      { messageId: "m1", content: "hello", createdAt: new Date() },
      60,
    );
    const ttl = await redis.ttl(`moderation:flood:${guildId}:${userId}`);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60);
  });
});
