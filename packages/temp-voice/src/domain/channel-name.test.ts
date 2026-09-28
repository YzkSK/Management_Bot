import { describe, expect, test } from "bun:test";
import { buildTempVoiceChannelName } from "./channel-name.js";

describe("buildTempVoiceChannelName", () => {
  test("{username}を入室者の表示名に置換する", () => {
    expect(buildTempVoiceChannelName("{username}のVC", "太郎")).toBe("太郎のVC");
  });

  test("{username}を含まないテンプレートはそのまま返す", () => {
    expect(buildTempVoiceChannelName("固定チャンネル名", "太郎")).toBe("固定チャンネル名");
  });

  test("複数の{username}をすべて置換する", () => {
    expect(buildTempVoiceChannelName("{username}/{username}", "太郎")).toBe("太郎/太郎");
  });

  test("展開後100文字を超える場合は100文字に切り詰める", () => {
    const longName = "a".repeat(150);
    const result = buildTempVoiceChannelName("{username}", longName);
    expect(result).toHaveLength(100);
    expect(result).toBe("a".repeat(100));
  });

  test("展開後ちょうど100文字なら切り詰めない", () => {
    const name100 = "a".repeat(100);
    expect(buildTempVoiceChannelName("{username}", name100)).toBe(name100);
  });
});
