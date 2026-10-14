import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { Redis } from "ioredis";
import { getActiveVoiceEntry, upsertActiveVoice } from "../application/index.js";
import { activeVoiceJoinedKey, activeVoiceKey } from "../domain/index.js";
import { type ActiveVoiceStateLike, rebuildActiveVoice, syncActiveVoice } from "./active-voice-sync.js";
import { KeyedQueue } from "./keyed-queue.js";

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

describe.skipIf(!(await isRedisAvailable()))("rebuildActiveVoice", () => {
  const redis = new Redis(REDIS_URL);
  const guildId = `g-${randomUUID()}`;
  const key = activeVoiceKey(guildId);
  const joinedKey = activeVoiceJoinedKey(guildId);

  function state(id: string, channelId: string | null, bot = false): ActiveVoiceStateLike {
    return {
      id,
      channelId,
      channel: channelId === null ? null : { name: channelId },
      guild: { id: guildId, afkChannelId: null },
      member: { displayName: id, displayAvatarURL: () => "https://cdn/a.png", user: { bot } },
      selfMute: false,
      selfDeaf: false,
      serverMute: false,
      serverDeaf: false,
      streaming: false,
      selfVideo: false,
    };
  }

  function guild(states: ActiveVoiceStateLike[]) {
    return { id: guildId, voiceStates: { cache: new Map(states.map((s) => [s.id, s])) } };
  }

  afterEach(async () => {
    await redis.del(key, joinedKey);
  });
  afterAll(() => redis.disconnect());

  test("在室者を反映し、いなくなった人とBotを除く。残っていた入室時刻は引き継ぐ", async () => {
    await upsertActiveVoice(redis, guildId, "stay", {
      channelId: "c1",
      channelName: "c1",
      afk: false,
      name: "stay",
      avatarUrl: null,
      joinedAt: "2026-09-29T09:00:00.000Z",
      selfMute: false,
      selfDeaf: false,
      serverMute: false,
      serverDeaf: false,
      streaming: false,
      video: false,
    });
    await redis.hset(key, "gone", "{}");
    const now = new Date("2026-09-29T12:00:00.000Z");
    await rebuildActiveVoice(redis, [guild([state("stay", "c1"), state("new", "c2"), state("bot", "c1", true)])], new KeyedQueue(), now, () => undefined);
    const hash = await redis.hgetall(key);
    expect(Object.keys(hash).sort()).toEqual(["new", "stay"]);
    expect(hash.stay).toContain("2026-09-29T09:00:00.000Z");
    expect(hash.new).toContain(now.toISOString());
  });

  test("作り直し中に届いた退室は、古いスナップショットで上書きされない", async () => {
    const queue = new KeyedQueue();
    const live = guild([state("u1", "c1")]);
    const rebuilding = rebuildActiveVoice(redis, [live], queue, new Date(), () => undefined);
    // 作り直しがRedisを読んでいる間に退室イベントが届く
    live.voiceStates.cache.set("u1", state("u1", null));
    const leaving = queue.run(`${guildId}:u1`, () => syncActiveVoice(redis, state("u1", null), new Date(), () => undefined));
    await Promise.all([rebuilding, leaving]);
    expect(await redis.hexists(key, "u1")).toBe(0);
  });
  test("表示用エントリが期限切れでも、入室時刻Hashから同じチャンネルなら引き継ぐ", async () => {
    await syncActiveVoice(redis, state("u1", "c1"), new Date("2026-09-29T09:00:00.000Z"), () => undefined);
    await redis.del(key); // bot停止で表示用Hashだけ期限切れ
    await syncActiveVoice(redis, state("u1", "c1"), new Date("2026-09-29T12:00:00.000Z"), () => undefined);
    expect((await getActiveVoiceEntry(redis, guildId, "u1"))?.joinedAt).toBe("2026-09-29T09:00:00.000Z");
  });
  test("入室時刻Hashのチャンネルと違えば起動時刻、不正値は無視する", async () => {
    await syncActiveVoice(redis, state("u1", "c1"), new Date("2026-09-29T09:00:00.000Z"), () => undefined);
    await redis.del(key);
    const now = new Date("2026-09-29T12:00:00.000Z");
    await syncActiveVoice(redis, state("u1", "c2"), now, () => undefined);
    expect((await getActiveVoiceEntry(redis, guildId, "u1"))?.joinedAt).toBe(now.toISOString());
    await redis.del(key);
    await redis.hset(joinedKey, "u1", JSON.stringify({ channelId: "c2", joinedAt: "not-a-date" }));
    await syncActiveVoice(redis, state("u1", "c2"), now, () => undefined);
    expect((await getActiveVoiceEntry(redis, guildId, "u1"))?.joinedAt).toBe(now.toISOString());
  });
  test("退室と再構築で入室時刻Hashのfieldも消える", async () => {
    await syncActiveVoice(redis, state("u1", "c1"), new Date(), () => undefined);
    await syncActiveVoice(redis, state("u1", null), new Date(), () => undefined);
    expect(await redis.hexists(joinedKey, "u1")).toBe(0);
    await redis.hset(joinedKey, "orphan", JSON.stringify({ channelId: "c1", joinedAt: "2026-09-29T09:00:00.000Z" }));
    await syncActiveVoice(redis, state("gone", "c1"), new Date(), () => undefined);
    await rebuildActiveVoice(redis, [guild([state("stay", "c1")])], new KeyedQueue(), new Date(), () => undefined);
    expect(Object.keys(await redis.hgetall(joinedKey))).toEqual(["stay"]);
  });
  test("syncActiveVoiceはキュー実行時点のcountingSinceを書く", async () => {
    const since = new Date("2026-09-29T10:00:00Z");
    await syncActiveVoice(redis, state("u1", "c1"), new Date(), () => since);
    expect((await getActiveVoiceEntry(redis, guildId, "u1"))?.countingSince).toBe(since.toISOString());
    await syncActiveVoice(redis, state("u2", "c1"), new Date(), () => undefined);
    expect((await getActiveVoiceEntry(redis, guildId, "u2"))?.countingSince).toBeNull();
  });
});
