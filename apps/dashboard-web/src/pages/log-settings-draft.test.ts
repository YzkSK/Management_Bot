import { describe, expect, test } from "bun:test";
import { buildLogSettingsDraft, diffLogSettings, hasLogSettingsChanges, planBulk } from "./log-settings-draft.js";

const server = {
  retention: [
    { category: "message", retentionDays: 30 },
    { category: "member", retentionDays: 30 },
  ],
  channel: [
    { category: "message", channelId: "c1" },
    { category: "member", channelId: null },
  ],
  display: { hideAuditLogCorrelation: true, hideBotEvents: false },
} as const;

describe("log-settings-draft", () => {
  test("サーバー値から作った下書きは変更なしと判定する", () => {
    const changes = diffLogSettings(server, buildLogSettingsDraft(server));
    expect(hasLogSettingsChanges(changes)).toBe(false);
  });

  test("変更したカテゴリ・表示設定だけを差分に含める", () => {
    const draft = buildLogSettingsDraft(server);
    draft.retention.member = "90";
    draft.channel.member = "c2";
    draft.showAuditLogCorrelation = true;

    const changes = diffLogSettings(server, draft);

    expect(changes.retention).toEqual([{ category: "member", retentionDays: 90 }]);
    expect(changes.channel).toEqual([{ category: "member", channelId: "c2" }]);
    expect(changes.display).toEqual({ hideAuditLogCorrelation: false });
    expect(hasLogSettingsChanges(changes)).toBe(true);
  });

  test("出力先を未設定(null)に戻す変更も差分になる", () => {
    const draft = buildLogSettingsDraft(server);
    draft.channel.message = null;
    expect(diffLogSettings(server, draft).channel).toEqual([{ category: "message", channelId: null }]);
  });

  test("保持期間の入力が不正なカテゴリはinvalidRetentionに入り、未保存扱いになる", () => {
    const draft = buildLogSettingsDraft(server);
    draft.retention.message = "abc";
    const changes = diffLogSettings(server, draft);
    expect(changes.invalidRetention).toEqual(["message"]);
    expect(changes.retention).toEqual([]);
    expect(hasLogSettingsChanges(changes)).toBe(true);
  });

  test("planBulk: 全カテゴリが同じ値になる変更なら一括値を返す", () => {
    expect(planBulk(2, [{ value: 7 }], [7, 7]).all).toBe(7);
    expect(planBulk(2, [{ value: 7 }], [7, 30]).all).toBeUndefined();
    expect(planBulk(2, [], [7, 7]).all).toBeUndefined();
  });
});
