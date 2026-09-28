import { afterEach, describe, expect, test } from "bun:test";
import { appEmojiText, findAppEmoji, setAppEmojis } from "./app-emoji.js";

describe("app-emoji", () => {
  afterEach(() => setAppEmojis([]));

  test("未登録ならfallbackを返し、findAppEmojiはundefined", () => {
    expect(appEmojiText("status_success", "✅")).toBe("✅");
    expect(findAppEmoji("status_success")).toBeUndefined();
  });

  test("登録済みなら<:name:id>、アニメーション絵文字は<a:name:id>を返す", () => {
    setAppEmojis([
      { id: "1", name: "status_success", animated: false },
      { id: "2", name: "loading", animated: true },
    ]);
    expect(appEmojiText("status_success", "✅")).toBe("<:status_success:1>");
    expect(appEmojiText("loading", "⏳")).toBe("<a:loading:2>");
    expect(findAppEmoji("status_success")).toEqual({ id: "1", name: "status_success", animated: false });
  });

  test("再設定すると以前の登録は消える", () => {
    setAppEmojis([{ id: "1", name: "status_success", animated: false }]);
    setAppEmojis([]);
    expect(appEmojiText("status_success", "✅")).toBe("✅");
  });
});
