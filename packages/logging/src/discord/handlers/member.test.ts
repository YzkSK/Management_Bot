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

function fakeMember(
  overrides: Partial<{
    id: string;
    nickname: string | null;
    communicationDisabledUntilTimestamp: number | null;
    bot: boolean;
    displayName: string;
    partial: boolean;
  }> = {},
) {
  const { bot = false, displayName = "たろう", partial = false, ...rest } = overrides;
  return {
    id: "u1",
    guild: { id: "g1" },
    nickname: null,
    communicationDisabledUntilTimestamp: null,
    user: { bot },
    displayName,
    partial,
    ...rest,
  } as never;
}

function fakeBan(bot = false) {
  return { guild: { id: "g1" }, user: { id: "u1", bot, displayName: "たろう" } } as never;
}

describe("member category mappers", () => {
  test("join", () => expect(toMemberJoinLogEntry(fakeMember()).action).toBe("join"));
  test("leave", () => expect(toMemberLeaveLogEntry(fakeMember()).action).toBe("leave"));
  test("ban", () => expect(toMemberBanLogEntry(fakeBan()).action).toBe("ban"));
  test("unban", () => expect(toMemberUnbanLogEntry(fakeBan()).action).toBe("unban"));

  test("イベント発生時点の表示名をuserNameにスナップショット保存する", () => {
    expect(toMemberJoinLogEntry(fakeMember()).userName).toBe("たろう");
    expect(toMemberBanLogEntry(fakeBan()).userName).toBe("たろう");
  });

  test("Botアカウントのjoinはactor" + "IsBot=trueとして記録する(除外はしない)", () => {
    expect(toMemberJoinLogEntry(fakeMember({ bot: true })).actorIsBot).toBe(true);
  });

  test("ban/unbanのuserIdは実行者ではなく対象のため、対象がBotでもactor" + "IsBotは設定しない", () => {
    expect(toMemberBanLogEntry(fakeBan(true)).actorIsBot).toBeUndefined();
    expect(toMemberUnbanLogEntry(fakeBan(true)).actorIsBot).toBeUndefined();
  });
});

describe("toMemberUpdateLogEntries", () => {
  test("ニックネーム設定時に変更前後の値を含むnicknameChangeを返す", () => {
    const entries = toMemberUpdateLogEntries(
      fakeMember({ nickname: null, displayName: "たろう" }),
      fakeMember({ nickname: "new" }),
    );
    expect(entries).toEqual([
      expect.objectContaining({
        action: "nicknameChange",
        previousUserName: "たろう",
        changes: { nickname: { before: null, after: "new" } },
      }),
    ]);
  });

  test("ニックネーム解除時に変更前後の値を含むnicknameChangeを返す", () => {
    const entries = toMemberUpdateLogEntries(fakeMember({ nickname: "old" }), fakeMember({ nickname: null }));
    expect(entries).toEqual([
      expect.objectContaining({
        action: "nicknameChange",
        changes: { nickname: { before: "old", after: null } },
      }),
    ]);
  });

  test("タイムアウト付与ならtimeoutを1件返す", () => {
    const entries = toMemberUpdateLogEntries(
      fakeMember({ communicationDisabledUntilTimestamp: null }),
      fakeMember({ communicationDisabledUntilTimestamp: Date.now() + 60_000 }),
    );
    expect(entries).toEqual([expect.objectContaining({ action: "timeout" })]);
  });

  test("タイムアウト解除(nullに戻る)ならtimeoutRemoveを1件返す", () => {
    const entries = toMemberUpdateLogEntries(
      fakeMember({ communicationDisabledUntilTimestamp: Date.now() + 60_000 }),
      fakeMember({ communicationDisabledUntilTimestamp: null }),
    );
    expect(entries).toEqual([expect.objectContaining({ action: "timeoutRemove" })]);
  });

  test("変化がなければ空配列", () => {
    expect(toMemberUpdateLogEntries(fakeMember(), fakeMember())).toEqual([]);
  });

  test("oldMemberがpartialなら実際は無変化でも誤検知せず空配列を返す", () => {
    const entries = toMemberUpdateLogEntries(
      fakeMember({ partial: true, nickname: null, communicationDisabledUntilTimestamp: null }),
      fakeMember({ nickname: "new", communicationDisabledUntilTimestamp: Date.now() + 60_000 }),
    );
    expect(entries).toEqual([]);
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
