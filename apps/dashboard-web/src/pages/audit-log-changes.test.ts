import { describe, expect, test } from "bun:test";
import { CAPABILITIES } from "@management-bot/shared";
import { describeCapabilityChange, describeChanges, formatValue } from "./audit-log-changes.js";

describe("formatValue", () => {
  test("null/undefinedは未設定、booleanはオン/オフ、日数はN日(0は無期限)", () => {
    expect(formatValue("text", null, {}, undefined)).toBe("未設定");
    expect(formatValue("bool", true, {}, undefined)).toBe("オン");
    expect(formatValue("bool", false, {}, undefined)).toBe("オフ");
    expect(formatValue("days", 30, {}, undefined)).toBe("30日");
    expect(formatValue("days", 0, {}, undefined)).toBe("無期限");
  });

  test("チャンネルは#名前、ロールは@名前。解決できなければIDのまま。配列は「、」区切り", () => {
    const names = { c1: "general", r1: "mod", u1: "ゆずき" };
    expect(formatValue("channel", "c1", names, undefined)).toBe("#general");
    expect(formatValue("channel", "c9", names, undefined)).toBe("c9");
    expect(formatValue("role", "r1", names, undefined)).toBe("@mod");
    expect(formatValue("user", "u1", names, undefined)).toBe("ゆずき");
    expect(formatValue("roles", ["r1", "r9"], names, undefined)).toBe("@mod、r9");
    expect(formatValue("roles", [], names, undefined)).toBe("なし");
  });
});

describe("describeCapabilityChange", () => {
  test("追加と削除を差分で表示し、差がなければnull", () => {
    const logs = CAPABILITIES.VIEW_LOGS;
    const activity = CAPABILITIES.VIEW_ACTIVITY;
    expect(describeCapabilityChange(logs, logs | activity)).toBe("追加: アクティビティの閲覧");
    expect(describeCapabilityChange(logs | activity, logs)).toBe("削除: アクティビティの閲覧");
    expect(describeCapabilityChange(logs, activity)).toBe("追加: アクティビティの閲覧 / 削除: ログの閲覧");
    expect(describeCapabilityChange(logs, logs)).toBeNull();
  });
});

describe("describeChanges", () => {
  test("値が変わった項目だけを変更前→変更後で返し、guildIdは除く", () => {
    const changes = describeChanges(
      "scheduledPost",
      "updateSettings",
      { allowedRoleIds: ["r1"], allowEveryone: false, allowHere: true },
      { guildId: "g", roleIds: ["r1", "r2"], allowEveryone: false, allowHere: true },
      { r1: "mod", r2: "event" },
    );
    expect(changes).toEqual([{ label: "使えるロール", before: "@mod", after: "@mod、@event" }]);
  });

  test("beforeが無い項目は変更後のみ表示する", () => {
    const changes = describeChanges("moderation", "addNgword", null, { guildId: "g", matchType: "exact", pattern: "bad" }, {});
    expect(changes).toEqual([
      { label: "一致方法", after: "完全一致" },
      { label: "パターン", after: "bad" },
    ]);
  });

  test("ログの保存期間・出力先は、カテゴリの一覧であるbeforeから該当カテゴリの値を取り出す", () => {
    expect(
      describeChanges(
        "logging",
        "setRetentionSetting",
        [{ category: "message", retentionDays: 30 }],
        { guildId: "g", category: "message", retentionDays: 90 },
        {},
      ),
    ).toEqual([{ label: "メッセージの保存期間", before: "30日", after: "90日" }]);
    expect(
      describeChanges(
        "logging",
        "setChannelSetting",
        [{ category: "message", channelId: null }],
        { guildId: "g", category: "message", channelId: "c1" },
        { c1: "mod-log" },
      ),
    ).toEqual([{ label: "メッセージの出力先", before: "未設定", after: "#mod-log" }]);
  });

  test("アクセス権限の変更は追加/削除の差分と対象の名前を表示する", () => {
    const changes = describeChanges(
      "access",
      "grantCapabilities",
      { targetType: "role", targetId: "r1", capabilities: CAPABILITIES.VIEW_LOGS },
      { guildId: "g", targetType: "role", targetId: "r1", capabilities: CAPABILITIES.VIEW_LOGS | CAPABILITIES.VIEW_ACTIVITY },
      { r1: "モデレーター" },
    );
    expect(changes).toEqual([
      { label: "対象", after: "@モデレーター" },
      { label: "権限", after: "追加: アクティビティの閲覧" },
    ]);
    expect(
      describeChanges(
        "access",
        "revokeCapabilityGrant",
        { capabilities: CAPABILITIES.VIEW_LOGS },
        { guildId: "g", targetType: "user", targetId: "u1" },
        { u1: "ゆずき" },
      ),
    ).toEqual([
      { label: "対象", after: "ゆずき" },
      { label: "権限", after: "削除: ログの閲覧" },
    ]);
  });

  test("未知の操作・キーでもキー名のまま表示する。afterがオブジェクトでなければ空", () => {
    expect(describeChanges("x", "y", { foo: 1 }, { foo: 2 }, {})).toEqual([{ label: "foo", before: "1", after: "2" }]);
    expect(describeChanges("x", "y", null, null, {})).toEqual([]);
  });

  test("一時VCの設定解除は作成用VCとカテゴリが未設定に戻ることを示す", () => {
    expect(
      describeChanges("tempVoice", "clearConfig", { createChannelId: "c1", categoryId: null }, { guildId: "g" }, { c1: "作成" }),
    ).toEqual([{ label: "作成用ボイスチャンネル", before: "#作成", after: "未設定" }]);
  });
});
