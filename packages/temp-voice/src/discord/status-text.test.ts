import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { setAppEmojis } from "@management-bot/shared";
import { STATUS_APP_EMOJIS, statusText } from "./status-text.js";

describe("statusText", () => {
  afterEach(() => setAppEmojis([]));

  test("使用する絵文字名はすべてassets/emojis/に画像がある", () => {
    for (const { name } of Object.values(STATUS_APP_EMOJIS)) {
      const path = fileURLToPath(new URL(`../../../../assets/emojis/${name}.png`, import.meta.url));
      expect(existsSync(path), name).toBe(true);
    }
  });

  test("未登録ならUnicode絵文字を先頭に付ける", () => {
    expect(statusText("success", "解除しました。")).toBe("✅ 解除しました。");
    expect(statusText("warning", "このVCのオーナーのみ操作できます。")).toBe("⚠️ このVCのオーナーのみ操作できます。");
    expect(statusText("failed", "解除に失敗しました。")).toBe("❌ 解除に失敗しました。");
  });

  test("登録済みならアプリ絵文字を先頭に付ける", () => {
    setAppEmojis([{ id: "1", name: "status_failed", animated: false }]);
    expect(statusText("failed", "解除に失敗しました。")).toBe("<:status_failed:1> 解除に失敗しました。");
  });
});
