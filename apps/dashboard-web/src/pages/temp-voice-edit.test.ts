import { describe, expect, test } from "bun:test";
import {
  buildChannelEditActions,
  buildChannelEditDraft,
  effectiveOverrides,
  validateChannelEditDraft,
  type ChannelEditInitial,
  type OverrideEntry,
} from "./temp-voice-edit.js";

const initial: ChannelEditInitial = { name: "VC", userLimit: 5, bitrate: 64_000, isLocked: false, isHidden: false };
const current: OverrideEntry[] = [{ targetType: "user", targetId: "u1", state: "allow", name: "Bob" }];

describe("buildChannelEditActions", () => {
  test("変更が無ければ操作は空", () => {
    expect(buildChannelEditActions(initial, buildChannelEditDraft(initial), current)).toEqual([]);
  });

  test("変更された項目だけを順に出し、オーナー移譲は最後になる", () => {
    const draft = {
      ...buildChannelEditDraft(initial),
      name: " 新しい名前 ",
      userLimit: "0",
      bitrateKbps: "96",
      locked: true,
      hidden: true,
      transferTo: "u9",
      pending: {
        "user:u1": { targetType: "user" as const, targetId: "u1", change: "deny" as const },
        "role:r1": { targetType: "role" as const, targetId: "r1", change: "allow" as const },
      },
    };
    expect(buildChannelEditActions(initial, draft, current)).toEqual([
      { type: "rename", name: "新しい名前" },
      { type: "userLimit", value: 0 },
      { type: "bitrate", kbps: 96 },
      { type: "setLocked", locked: true },
      { type: "setHidden", hidden: true },
      { type: "deny", targetType: "user", targetId: "u1" },
      { type: "permit", targetType: "role", targetId: "r1" },
      { type: "transferOwner", userId: "u9" },
    ]);
  });

  test("既存と同じ状態の追加・存在しない対象の解除は送らず、既存の解除はremoveOverrideになる", () => {
    const draft = {
      ...buildChannelEditDraft(initial),
      pending: {
        "user:u1": { targetType: "user" as const, targetId: "u1", change: "remove" as const },
        "user:u2": { targetType: "user" as const, targetId: "u2", change: "remove" as const },
      },
    };
    expect(buildChannelEditActions(initial, draft, current)).toEqual([{ type: "removeOverride", targetType: "user", targetId: "u1" }]);
    const same = { ...buildChannelEditDraft(initial), pending: { "user:u1": { targetType: "user" as const, targetId: "u1", change: "allow" as const } } };
    expect(buildChannelEditActions(initial, same, current)).toEqual([]);
  });
});

describe("effectiveOverrides", () => {
  test("未保存の変更を重ねた一覧を返す", () => {
    const merged = effectiveOverrides(current, {
      "user:u1": { targetType: "user", targetId: "u1", change: "remove" },
      "role:r1": { targetType: "role", targetId: "r1", name: "R", change: "deny" },
    });
    expect(merged).toEqual([{ targetType: "role", targetId: "r1", state: "deny", name: "R" }]);
  });
});

describe("validateChannelEditDraft", () => {
  test("不正な値を検出する", () => {
    const draft = { ...buildChannelEditDraft(initial), name: "", userLimit: "100", bitrateKbps: "7" };
    expect(validateChannelEditDraft(draft, "VC")).toHaveLength(3);
    expect(validateChannelEditDraft(buildChannelEditDraft(initial), "VC")).toEqual([]);
  });
});
