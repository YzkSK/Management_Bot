import { describe, expect, mock, test } from "bun:test";
import type { FeatureModuleContext } from "@management-bot/core";
import {
  registerMemberHandlers,
  toMemberBanLogEntry,
  toMemberJoinLogEntry,
  toMemberLeaveLogEntry,
  toMemberUnbanLogEntry,
  toMemberUpdateLogEntries,
} from "./member.js";

function fakeMember(overrides: Partial<{ id: string; nickname: string | null; communicationDisabledUntilTimestamp: number | null }> = {}) {
  return {
    id: "u1",
    guild: { id: "g1" },
    nickname: null,
    communicationDisabledUntilTimestamp: null,
    ...overrides,
  } as never;
}

function fakeBan() {
  return { guild: { id: "g1" }, user: { id: "u1" } } as never;
}

describe("member category mappers", () => {
  test("join", () => expect(toMemberJoinLogEntry(fakeMember()).action).toBe("join"));
  test("leave", () => expect(toMemberLeaveLogEntry(fakeMember()).action).toBe("leave"));
  test("ban", () => expect(toMemberBanLogEntry(fakeBan()).action).toBe("ban"));
  test("unban", () => expect(toMemberUnbanLogEntry(fakeBan()).action).toBe("unban"));
});

describe("toMemberUpdateLogEntries", () => {
  test("ニックネーム変更のみならnicknameChangeを1件返す", () => {
    const entries = toMemberUpdateLogEntries(fakeMember({ nickname: "old" }), fakeMember({ nickname: "new" }));
    expect(entries).toEqual([expect.objectContaining({ action: "nicknameChange" })]);
  });

  test("タイムアウト付与ならtimeoutを1件返す", () => {
    const entries = toMemberUpdateLogEntries(
      fakeMember({ communicationDisabledUntilTimestamp: null }),
      fakeMember({ communicationDisabledUntilTimestamp: Date.now() + 60_000 }),
    );
    expect(entries).toEqual([expect.objectContaining({ action: "timeout" })]);
  });

  test("タイムアウト解除(nullに戻る)は記録しない", () => {
    const entries = toMemberUpdateLogEntries(
      fakeMember({ communicationDisabledUntilTimestamp: Date.now() + 60_000 }),
      fakeMember({ communicationDisabledUntilTimestamp: null }),
    );
    expect(entries).toEqual([]);
  });

  test("変化がなければ空配列", () => {
    expect(toMemberUpdateLogEntries(fakeMember(), fakeMember())).toEqual([]);
  });
});

describe("registerMemberHandlers", () => {
  test("必要な5イベントをclient.onに登録する", () => {
    const on = mock(() => undefined);
    const ctx = { client: { on }, db: {} } as unknown as FeatureModuleContext;

    registerMemberHandlers(ctx);

    const events = on.mock.calls.map((call) => call[0]);
    expect(events).toEqual(
      expect.arrayContaining(["guildMemberAdd", "guildMemberRemove", "guildBanAdd", "guildBanRemove", "guildMemberUpdate"]),
    );
  });
});
