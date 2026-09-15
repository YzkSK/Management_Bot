import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, test } from "bun:test";
import { Redis } from "ioredis";
import { claimAndPushMessage, markStrikeHitAndCheckNewBurst } from "./message-buffer.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
      { messageId: "m1", channelId: "c1", content: "hello", createdAt: new Date("2026-01-01T00:00:00.000Z") },
      3600,
      60,
    );
    const buffer = await claimAndPushMessage(
      redis,
      guildId,
      userId,
      { messageId: "m2", channelId: "c1", content: "world", createdAt: new Date("2026-01-01T00:00:01.000Z") },
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
      { messageId: `m-${randomUUID()}`, channelId: "c1", content: "hello", createdAt: new Date() },
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
      { messageId, channelId: "c1", content: "hello", createdAt: new Date() },
      3600,
      60,
    );
    const second = await claimAndPushMessage(
      redis,
      guildId,
      userId,
      { messageId, channelId: "c1", content: "hello", createdAt: new Date() },
      3600,
      60,
    );

    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(first).toHaveLength(1);
  });
});

describe.skipIf(!(await isRedisAvailable()))("markStrikeHitAndCheckNewBurst", () => {
  const redis = new Redis(REDIS_URL);
  const guildId = `g-${randomUUID()}`;
  const userId = `u-${randomUUID()}`;

  afterEach(async () => {
    const keys = await redis.keys(`moderation:*:${guildId}:*`);
    if (keys.length > 0) await redis.del(...keys);
  });

  test("初回はstrikeできる", async () => {
    const canStrike = await markStrikeHitAndCheckNewBurst(redis, guildId, userId, "flood", 8);
    expect(canStrike).toBe(true);
  });

  test("直近のstrikeからwindowSeconds未満の2回目はstrikeできない", async () => {
    await markStrikeHitAndCheckNewBurst(redis, guildId, userId, "flood", 8);
    const canStrike = await markStrikeHitAndCheckNewBurst(redis, guildId, userId, "flood", 8);
    expect(canStrike).toBe(false);
  });

  test("violationTypeが異なれば独立して判定される", async () => {
    await markStrikeHitAndCheckNewBurst(redis, guildId, userId, "flood", 8);
    const canStrike = await markStrikeHitAndCheckNewBurst(redis, guildId, userId, "duplicate_content", 8);
    expect(canStrike).toBe(true);
  });

  test("連投が途切れなくても、直近のstrikeからwindowSeconds経過すれば再びstrikeできる", async () => {
    await markStrikeHitAndCheckNewBurst(redis, guildId, userId, "flood", 1);
    // windowSeconds(1秒)未満での連投はstrikeできない
    await sleep(300);
    const stillBlocked = await markStrikeHitAndCheckNewBurst(redis, guildId, userId, "flood", 1);
    expect(stillBlocked).toBe(false);
    // 直近のstrikeから合計1秒を超えれば、連投が途切れていなくてもstrikeできる
    await sleep(800);
    const canStrike = await markStrikeHitAndCheckNewBurst(redis, guildId, userId, "flood", 1);
    expect(canStrike).toBe(true);
  }, 10000);

  test("継続中バースト(strikeできない)へのヒットでもTTLがwindowSecondsに延長される", async () => {
    const key = `moderation:strike-lock:${guildId}:${userId}:flood`;
    await markStrikeHitAndCheckNewBurst(redis, guildId, userId, "flood", 5);
    await sleep(2500);
    const ttlBeforeSecondHit = await redis.pttl(key);
    // 5秒のTTLを設定してから2.5秒経過しているため、延長がなければ残りTTLは約2.5秒のはず
    expect(ttlBeforeSecondHit).toBeLessThan(3000);

    // strikeできない(継続中バースト)ヒットでもEXPIREでTTLがwindowSeconds(5秒)に戻ることを確認
    const canStrike = await markStrikeHitAndCheckNewBurst(redis, guildId, userId, "flood", 5);
    expect(canStrike).toBe(false);
    const ttlAfterSecondHit = await redis.pttl(key);
    expect(ttlAfterSecondHit).toBeGreaterThan(4000);
  }, 10000);

  test("最後のヒットからwindowSeconds秒静かになった後の初回ヒットもstrikeできる", async () => {
    await markStrikeHitAndCheckNewBurst(redis, guildId, userId, "flood", 1);
    await sleep(1500);
    const canStrike = await markStrikeHitAndCheckNewBurst(redis, guildId, userId, "flood", 1);
    expect(canStrike).toBe(true);
  }, 10000);
});
