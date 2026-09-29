import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { Redis } from "ioredis";
import { type ActiveVoiceEntry, activeVoiceKey } from "../domain/index.js";
import {
  ACTIVE_VOICE_TTL_SECONDS,
  extendActiveVoiceTtl,
  getActiveVoiceEntry,
  readActiveVoice,
  removeActiveVoice,
  listActiveVoiceUserIds,
  upsertActiveVoice,
} from "./active-voice-store.js";

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

function entry(overrides: Partial<ActiveVoiceEntry> = {}): ActiveVoiceEntry {
  return {
    channelId: "c1",
    channelName: "雑談VC",
    afk: false,
    name: "Alice",
    avatarUrl: null,
    joinedAt: "2026-09-29T10:00:00.000Z",
    selfMute: false,
    selfDeaf: false,
    serverMute: false,
    serverDeaf: false,
    streaming: false,
    video: false,
    ...overrides,
  };
}

describe.skipIf(!(await isRedisAvailable()))("active-voice-store", () => {
  const redis = new Redis(REDIS_URL);
  const guildId = `g-${randomUUID()}`;
  const readHash = (key: string) => redis.hgetall(key);

  afterEach(async () => {
    await redis.del(activeVoiceKey(guildId));
  });
  afterAll(() => redis.disconnect());

  test("入室 → ミュート → 移動 → 退室をチャンネル別表示まで通しで反映する", async () => {
    await upsertActiveVoice(redis, guildId, "u1", entry());
    await upsertActiveVoice(redis, guildId, "u2", entry({ name: "Bob", joinedAt: "2026-09-29T10:30:00.000Z" }));
    // ミュート: 入室時刻は呼び出し側(nextJoinedAt)で保たれる前提で、フラグだけ変わる
    const prev = await getActiveVoiceEntry(redis, guildId, "u1");
    await upsertActiveVoice(redis, guildId, "u1", { ...entry(), selfMute: true, joinedAt: prev?.joinedAt ?? "" });
    let channels = await readActiveVoice(readHash, guildId);
    expect(channels).toHaveLength(1);
    expect(channels[0]?.startedAt).toBe("2026-09-29T10:00:00.000Z");
    expect(channels[0]?.members.find((m) => m.userId === "u1")?.counting).toBe(false);

    await upsertActiveVoice(
      redis,
      guildId,
      "u2",
      entry({ channelId: "c2", channelName: "ゲームVC", name: "Bob", joinedAt: "2026-09-29T11:00:00.000Z" }),
    );
    channels = await readActiveVoice(readHash, guildId);
    expect(channels.map((c) => [c.channelId, c.members.length]).sort()).toEqual([
      ["c1", 1],
      ["c2", 1],
    ]);

    await removeActiveVoice(redis, guildId, "u2");
    channels = await readActiveVoice(readHash, guildId);
    expect(channels.map((c) => c.channelId)).toEqual(["c1"]);
  });

  test("書き込み時にTTLを付け、extendで延長する", async () => {
    await upsertActiveVoice(redis, guildId, "u1", entry());
    const ttl = await redis.ttl(activeVoiceKey(guildId));
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(ACTIVE_VOICE_TTL_SECONDS);
    await redis.expire(activeVoiceKey(guildId), 5);
    await extendActiveVoiceTtl(redis, [guildId]);
    expect(await redis.ttl(activeVoiceKey(guildId))).toBeGreaterThan(5);
  });

  test("保存済みメンバーのIDを列挙する", async () => {
    expect(await listActiveVoiceUserIds(redis, guildId)).toEqual([]);
    await upsertActiveVoice(redis, guildId, "u1", entry());
    expect(await listActiveVoiceUserIds(redis, guildId)).toEqual(["u1"]);
  });

  test("キーが無ければ空、壊れた値は捨てる", async () => {
    expect(await readActiveVoice(readHash, guildId)).toEqual([]);
    await redis.hset(activeVoiceKey(guildId), "bad", "{");
    expect(await readActiveVoice(readHash, guildId)).toEqual([]);
  });
});
