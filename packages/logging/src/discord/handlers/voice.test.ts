import { describe, expect, mock, test } from "bun:test";
import type { FeatureModuleContext } from "@management-bot/core";
import { registerVoiceHandlers, toVoiceStateLogEntry, toVoiceStateUpdateEntry } from "./voice.js";

function fakeVoiceState(
  channelId: string | null,
  flags?: Partial<{ selfMute: boolean; selfDeaf: boolean; serverMute: boolean; serverDeaf: boolean; streaming: boolean }>,
) {
  return {
    id: "u1",
    channelId,
    guild: { id: "g1" },
    selfMute: false,
    selfDeaf: false,
    serverMute: false,
    serverDeaf: false,
    streaming: false,
    ...flags,
  } as never;
}

describe("toVoiceStateLogEntry", () => {
  test("未参加→参加はjoin", () => {
    const entry = toVoiceStateLogEntry(fakeVoiceState(null), fakeVoiceState("c1"));
    expect(entry).toMatchObject({ category: "voice", action: "join", channelId: "c1", userId: "u1" });
  });

  test("参加→未参加はleave(退室元のチャンネルIDを記録)", () => {
    const entry = toVoiceStateLogEntry(fakeVoiceState("c1"), fakeVoiceState(null));
    expect(entry).toMatchObject({ category: "voice", action: "leave", channelId: "c1" });
  });

  test("チャンネル間の異動はmove(移動先channelId・移動元previousChannelId)", () => {
    const entry = toVoiceStateLogEntry(fakeVoiceState("c1"), fakeVoiceState("c2"));
    expect(entry).toMatchObject({ category: "voice", action: "move", channelId: "c2", previousChannelId: "c1" });
  });

  test("同一チャンネル内の変更(ミュート等)はundefined", () => {
    expect(toVoiceStateLogEntry(fakeVoiceState("c1"), fakeVoiceState("c1"))).toBeUndefined();
  });

  test("未参加のまま変化なしもundefined", () => {
    expect(toVoiceStateLogEntry(fakeVoiceState(null), fakeVoiceState(null))).toBeUndefined();
  });
});

describe("toVoiceStateUpdateEntry", () => {
  test("同一チャンネル内でselfMuteがONになるとupdate", () => {
    const entry = toVoiceStateUpdateEntry(fakeVoiceState("c1"), fakeVoiceState("c1", { selfMute: true }));
    expect(entry).toMatchObject({
      category: "voice",
      action: "update",
      channelId: "c1",
      userId: "u1",
      changes: { selfMute: { before: false, after: true } },
    });
  });

  test("同一チャンネル内でserverMuteがONになるとupdate", () => {
    const entry = toVoiceStateUpdateEntry(fakeVoiceState("c1"), fakeVoiceState("c1", { serverMute: true }));
    expect(entry).toMatchObject({
      category: "voice",
      action: "update",
      channelId: "c1",
      userId: "u1",
      changes: { serverMute: { before: false, after: true } },
    });
  });

  test("serverDeafとstreamingが同時に変わると両方changesに入る", () => {
    const entry = toVoiceStateUpdateEntry(
      fakeVoiceState("c1"),
      fakeVoiceState("c1", { serverDeaf: true, streaming: true }),
    );
    expect(entry).toMatchObject({
      changes: {
        serverDeaf: { before: false, after: true },
        streaming: { before: false, after: true },
      },
    });
  });

  test("変化なしはundefined", () => {
    expect(toVoiceStateUpdateEntry(fakeVoiceState("c1"), fakeVoiceState("c1"))).toBeUndefined();
  });

  test("チャンネル移動と同時のselfMute変更は移動先channelIdでupdateとして記録する(moveと両方発行される)", () => {
    const entry = toVoiceStateUpdateEntry(fakeVoiceState("c1"), fakeVoiceState("c2", { selfMute: true }));
    expect(entry).toMatchObject({
      category: "voice",
      action: "update",
      channelId: "c2",
      changes: { selfMute: { before: false, after: true } },
    });
  });

  test("チャンネル移動のみ(フラグ変化なし)はundefined", () => {
    expect(toVoiceStateUpdateEntry(fakeVoiceState("c1"), fakeVoiceState("c2"))).toBeUndefined();
  });

  test("未参加のままの変化はundefined", () => {
    expect(toVoiceStateUpdateEntry(fakeVoiceState(null), fakeVoiceState(null, { selfMute: true }))).toBeUndefined();
  });
});

describe("registerVoiceHandlers", () => {
  test("voiceStateUpdateをclient.onに登録する", () => {
    const on = mock(() => undefined);
    const ctx = { client: { on }, db: {} } as unknown as FeatureModuleContext;

    registerVoiceHandlers(ctx);

    expect(on.mock.calls.map((call) => call[0])).toEqual(["voiceStateUpdate"]);
  });

  test("同一チャンネル内でのミュート変化をwriteLogEntrySafely経由で書き込む", async () => {
    let listener: ((oldState: unknown, newState: unknown) => void) | undefined;
    const on = mock((_event: string, handler: (oldState: unknown, newState: unknown) => void) => {
      listener = handler;
    });
    const values = mock((v: unknown) => {
      inserted.push(v);
      return { onConflictDoNothing: () => ({ returning: () => Promise.resolve([{ id: "id1" }]) }) };
    });
    const inserted: unknown[] = [];
    const db = {
      insert: () => ({ values }),
      select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
    };
    const ctx = { client: { on }, db } as unknown as FeatureModuleContext;

    registerVoiceHandlers(ctx);
    listener?.(fakeVoiceState("c1"), fakeVoiceState("c1", { streaming: true }));
    await new Promise((resolve) => setImmediate(resolve));

    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ category: "voice", payload: { action: "update" } });
  });
});
