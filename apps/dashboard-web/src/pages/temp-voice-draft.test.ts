import { describe, expect, test } from "bun:test";
import { buildTempVoiceDraft, diffTempVoiceConfig, hasTempVoiceChanges } from "./temp-voice-draft.js";

const config = {
  createChannelId: "vc1",
  categoryId: "cat1",
  nameTemplate: "{username}のVC",
  defaultUserLimit: 0,
  defaultBitrate: 64000,
};

describe("temp-voice-draft", () => {
  test("サーバー値から作った下書きは変更なし", () => {
    expect(hasTempVoiceChanges(diffTempVoiceConfig(config, buildTempVoiceDraft(config)))).toBe(false);
  });

  test("変更したフィールドだけを部分更新の入力にする", () => {
    const draft = { ...buildTempVoiceDraft(config), nameTemplate: "{username}の部屋", bitrateKbps: "96" };
    expect(diffTempVoiceConfig(config, draft).input).toEqual({ nameTemplate: "{username}の部屋", defaultBitrate: 96000 });
  });

  test("作成用チャンネルを変えたらカテゴリと一緒に送る", () => {
    const draft = { ...buildTempVoiceDraft(config), createChannelId: "vc2" };
    expect(diffTempVoiceConfig(config, draft).input).toEqual({ createChannelId: "vc2", categoryId: "cat1" });
  });

  test("音質を空にすると未設定(null)に戻す", () => {
    const draft = { ...buildTempVoiceDraft(config), bitrateKbps: "" };
    expect(diffTempVoiceConfig(config, draft).input).toEqual({ defaultBitrate: null });
  });

  test("不正な入力はエラーにし、保存対象に含めない", () => {
    const draft = { ...buildTempVoiceDraft(config), userLimit: "100", bitrateKbps: "-1", categoryId: "" };
    const changes = diffTempVoiceConfig(config, draft);
    expect(changes.input).toEqual({});
    expect(changes.errors).toHaveLength(3);
    expect(hasTempVoiceChanges(changes)).toBe(true);
  });
});
