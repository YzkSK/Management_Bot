import { describe, expect, mock, test } from "bun:test";
import type { FeatureModuleContext } from "@management-bot/core";
import { registerChannelHandlers, toChannelCreateLogEntry, toChannelDeleteLogEntry, toChannelUpdateLogEntry } from "./channel.js";

function fakeGuildChannel(id = "c1") {
  return { id, guild: { id: "g1" } } as never;
}

function fakeDMChannel() {
  return { id: "dm1" } as never;
}

describe("channel category mappers", () => {
  test("create", () => expect(toChannelCreateLogEntry(fakeGuildChannel()).action).toBe("create"));

  test("update: guildチャンネルならupdateエントリを返す", () => {
    expect(toChannelUpdateLogEntry(fakeGuildChannel(), fakeGuildChannel())?.action).toBe("update");
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
