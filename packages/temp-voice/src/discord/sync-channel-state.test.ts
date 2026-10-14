import { describe, expect, test } from "bun:test";
import { PermissionFlagsBits } from "discord.js";
import { parseTempVoiceChannelState } from "../domain/index.js";
import {
  buildTempVoiceChannelState,
  rebuildTempVoiceChannelStates,
  removeTempVoiceChannelState,
  syncTempVoiceChannelState,
  syncTempVoiceChannelStateOnVoiceUpdate,
} from "./sync-channel-state.js";
import { VoiceSessionStore } from "./voice-session-store.js";

/** Redis Hashのみを模した最小のフェイク(key → field → value)。 */
function createFakeRedis() {
  const hashes = new Map<string, Map<string, string>>();
  const hash = (key: string) => {
    let h = hashes.get(key);
    if (!h) hashes.set(key, (h = new Map()));
    return h;
  };
  const redis = {
    multi() {
      const ops: (() => void)[] = [];
      const chain = {
        hset(key: string, field: string, value: string) {
          ops.push(() => void hash(key).set(field, value));
          return chain;
        },
        expire() {
          return chain;
        },
        exec: async () => void ops.forEach((op) => op()),
      };
      return chain;
    },
    hdel: async (key: string, field: string) => void hash(key).delete(field),
    hkeys: async (key: string) => [...hash(key).keys()],
  };
  return { redis: redis as never, hash };
}

function member(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    user: { bot: false },
    displayName: `name-${id}`,
    displayAvatarURL: () => `https://cdn/${id}.png`,
    voice: { selfMute: true, serverMute: false, selfDeaf: false, serverDeaf: false, streaming: true, selfVideo: false },
    ...overrides,
  };
}

function voiceChannel(id: string, members: unknown[], denied: bigint[] = []) {
  return {
    id,
    userLimit: 3,
    bitrate: 64000,
    members: new Map(members.map((m, i) => [String(i), m])),
    guild: {
      id: "g1",
      roles: { everyone: { id: "everyone" } },
    },
    permissionOverwrites: {
      cache: new Map([["everyone", { deny: { has: (flag: bigint) => denied.includes(flag) } }]]),
    },
    isVoiceBased: () => true,
  };
}

describe("buildTempVoiceChannelState", () => {
  test("設定値・ロック/非表示・在室メンバー(botを除く)を組み立てる", () => {
    const channel = voiceChannel(
      "vc-1",
      [member("u1"), member("bot", { user: { bot: true } })],
      [PermissionFlagsBits.Connect],
    );

    expect(buildTempVoiceChannelState(channel as never)).toEqual({
      userLimit: 3,
      bitrate: 64000,
      isLocked: true,
      isHidden: false,
      members: [
        {
          userId: "u1",
          name: "name-u1",
          avatarUrl: "https://cdn/u1.png",
          selfMute: true,
          serverMute: false,
          selfDeaf: false,
          serverDeaf: false,
          streaming: true,
          video: false,
        },
      ],
    });
  });
});

describe("syncTempVoiceChannelState", () => {
  test("追跡中の一時VCだけRedisへ書き、書いた値はスキーマを通る", async () => {
    const { redis, hash } = createFakeRedis();
    const sessionStore = new VoiceSessionStore();
    sessionStore.startTrackingChannel("vc-1");

    syncTempVoiceChannelState({ redis, sessionStore }, voiceChannel("vc-1", [member("u1")]) as never);
    syncTempVoiceChannelState({ redis, sessionStore }, voiceChannel("vc-other", [member("u1")]) as never);
    await Bun.sleep(0);

    const stored = hash("temp-voice:state:g1");
    expect([...stored.keys()]).toEqual(["vc-1"]);
    expect(parseTempVoiceChannelState(stored.get("vc-1"))?.members).toHaveLength(1);
  });

  test("voiceStateUpdateは旧・新両方のチャンネルを書き直す", async () => {
    const { redis, hash } = createFakeRedis();
    const sessionStore = new VoiceSessionStore();
    sessionStore.startTrackingChannel("vc-1");
    sessionStore.startTrackingChannel("vc-2");

    syncTempVoiceChannelStateOnVoiceUpdate(
      { redis, sessionStore },
      { channelId: "vc-1", channel: voiceChannel("vc-1", []) } as never,
      { channelId: "vc-2", channel: voiceChannel("vc-2", [member("u1")]) } as never,
    );
    await Bun.sleep(0);

    expect([...hash("temp-voice:state:g1").keys()].sort()).toEqual(["vc-1", "vc-2"]);
  });

  test("チャンネル削除でfieldを消す", async () => {
    const { redis, hash } = createFakeRedis();
    hash("temp-voice:state:g1").set("vc-1", "x");

    removeTempVoiceChannelState({ redis, sessionStore: new VoiceSessionStore() }, "g1", "vc-1");
    await Bun.sleep(0);

    expect(hash("temp-voice:state:g1").size).toBe(0);
  });
});

describe("rebuildTempVoiceChannelStates", () => {
  test("DB上の一時VCを書き直し、DBに無い・Discord上に無いfieldを消す", async () => {
    const { redis, hash } = createFakeRedis();
    hash("temp-voice:state:g1").set("vc-stale", "x");
    hash("temp-voice:state:g1").set("vc-gone", "x");
    const vc1 = voiceChannel("vc-1", [member("u1")]);
    const client = {
      guilds: { cache: new Map([["g1", { channels: { cache: new Map([["vc-1", vc1]]) } }]]) },
    };

    await rebuildTempVoiceChannelStates({
      redis,
      sessionStore: new VoiceSessionStore(),
      db: {} as never,
      client: client as never,
      listGuildIds: async () => ["g1"],
      // vc-goneはDBにあるがDiscord上に無い
      listChannels: async () => [{ channelId: "vc-1" }, { channelId: "vc-gone" }] as never,
    });

    expect([...hash("temp-voice:state:g1").keys()]).toEqual(["vc-1"]);
  });
});
