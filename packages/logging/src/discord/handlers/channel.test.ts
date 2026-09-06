import { describe, expect, mock, test } from "bun:test";
import type { FeatureModuleContext } from "@management-bot/core";
import { registerChannelHandlers, toChannelCreateLogEntry, toChannelDeleteLogEntry, toChannelUpdateLogEntry } from "./channel.js";

function fakeGuildChannel(id = "c1", overrides: Partial<Record<"name" | "topic" | "nsfw" | "rateLimitPerUser" | "bitrate" | "userLimit", unknown>> = {}) {
  return {
    id,
    guild: { id: "g1" },
    name: "channel",
    topic: null,
    nsfw: false,
    rateLimitPerUser: 0,
    bitrate: 64000,
    userLimit: 0,
    ...overrides,
  } as never;
}

function fakeDMChannel() {
  return { id: "dm1" } as never;
}

describe("channel category mappers", () => {
  test("create", () => expect(toChannelCreateLogEntry(fakeGuildChannel()).action).toBe("create"));

  test("update: 名前が変わればchangesに反映される(他の未変更フィールドは含まれない)", () => {
    const entry = toChannelUpdateLogEntry(fakeGuildChannel("c1", { name: "old" }), fakeGuildChannel("c1", { name: "new" }));
    expect(entry?.action).toBe("update");
    expect(entry?.changes).toEqual({ name: { before: "old", after: "new" } });
  });

  test("update: topicがnullから文字列に変わればchangesに反映される(空文字への丸めをしない)", () => {
    const entry = toChannelUpdateLogEntry(fakeGuildChannel("c1", { topic: null }), fakeGuildChannel("c1", { topic: "new topic" }));
    expect(entry?.changes).toEqual({ topic: { before: null, after: "new topic" } });
  });

  test("update: topicが文字列からnullに変わればchangesに反映される", () => {
    const entry = toChannelUpdateLogEntry(fakeGuildChannel("c1", { topic: "old topic" }), fakeGuildChannel("c1", { topic: null }));
    expect(entry?.changes).toEqual({ topic: { before: "old topic", after: null } });
  });

  test("update: 差分がなければundefined(無関係なチャンネルへの波及を記録しない)", () => {
    expect(toChannelUpdateLogEntry(fakeGuildChannel(), fakeGuildChannel())).toBeUndefined();
  });

  test("update: topic/nsfw/rateLimitPerUser/bitrate/userLimitの差分もそれぞれchangesに反映される", () => {
    const entry = toChannelUpdateLogEntry(
      fakeGuildChannel("c1", { topic: "old topic", nsfw: false, rateLimitPerUser: 0, bitrate: 64000, userLimit: 0 }),
      fakeGuildChannel("c1", { topic: "new topic", nsfw: true, rateLimitPerUser: 10, bitrate: 96000, userLimit: 5 }),
    );
    expect(entry).toMatchObject({
      changes: {
        topic: { before: "old topic", after: "new topic" },
        nsfw: { before: false, after: true },
        rateLimitPerUser: { before: 0, after: 10 },
        bitrate: { before: 64000, after: 96000 },
        userLimit: { before: 0, after: 5 },
      },
    });
  });

  test("update: DMチャンネルはundefined", () => {
    expect(toChannelUpdateLogEntry(fakeDMChannel(), fakeDMChannel())).toBeUndefined();
  });

  test("delete: guildチャンネルならdeleteエントリを返す", () => {
    expect(toChannelDeleteLogEntry(fakeGuildChannel())?.action).toBe("delete");
  });

  test("delete: DMチャンネルはundefined", () => {
    expect(toChannelDeleteLogEntry(fakeDMChannel())).toBeUndefined();
  });
});

describe("registerChannelHandlers", () => {
  test("必要な3イベントをclient.onに登録する", () => {
    const on = mock(() => undefined);
    const ctx = { client: { on }, db: {} } as unknown as FeatureModuleContext;

    registerChannelHandlers(ctx);

    const events = on.mock.calls.map((call) => call[0]);
    expect(events).toEqual(expect.arrayContaining(["channelCreate", "channelUpdate", "channelDelete"]));
  });
});
