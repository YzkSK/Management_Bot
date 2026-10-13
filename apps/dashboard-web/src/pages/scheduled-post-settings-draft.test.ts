import { describe, expect, test } from "bun:test";
import {
  buildScheduledPostSettingsDraft,
  hasScheduledPostSettingsChanges,
  toUpdateSettingsInput,
} from "./scheduled-post-settings-draft.js";

const server = { allowedRoleIds: ["r1", "r2"], allowEveryone: false, allowHere: true };

describe("scheduled-post-settings-draft", () => {
  test("サーバーの値から作った下書きは変更なし。編集すると変更あり、元に戻すと変更なしに戻る", () => {
    const draft = buildScheduledPostSettingsDraft(server);
    expect(hasScheduledPostSettingsChanges(server, draft)).toBe(false);

    expect(hasScheduledPostSettingsChanges(server, { ...draft, allowEveryone: true })).toBe(true);
    expect(hasScheduledPostSettingsChanges(server, { ...draft, roleIds: ["r1"] })).toBe(true);
    expect(hasScheduledPostSettingsChanges(server, { ...draft, roleIds: [...draft.roleIds, "r3"] })).toBe(true);
    // ロールの並びだけが違う場合は変更なし。
    expect(hasScheduledPostSettingsChanges(server, { ...draft, roleIds: ["r2", "r1"] })).toBe(false);
  });

  test("下書きを編集しても元のサーバー状態は変わらない(破棄で作り直せる)", () => {
    const draft = buildScheduledPostSettingsDraft(server);
    draft.roleIds.push("r3");
    expect(server.allowedRoleIds).toEqual(["r1", "r2"]);
    expect(buildScheduledPostSettingsDraft(server).roleIds).toEqual(["r1", "r2"]);
  });

  test("保存はupdateSettingsの入力(roleIds・allowEveryone・allowHere)に変換する", () => {
    const draft = { roleIds: ["r1"], allowEveryone: true, allowHere: false };
    expect(toUpdateSettingsInput("g1", draft)).toEqual({ guildId: "g1", roleIds: ["r1"], allowEveryone: true, allowHere: false });
  });
});
