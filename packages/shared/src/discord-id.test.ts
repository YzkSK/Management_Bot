import { describe, expect, test } from "bun:test";
import { roleMentionLabel } from "./discord-id.js";

describe("roleMentionLabel", () => {
  test("ロール名に@を付ける", () => {
    expect(roleMentionLabel("モデレーター")).toBe("@モデレーター");
  });

  test("@everyoneロールには付け足さない", () => {
    expect(roleMentionLabel("@everyone")).toBe("@everyone");
  });

  test("@everyone以外で@から始まるロール名は名前の一部なのでそのまま@を付ける", () => {
    expect(roleMentionLabel("@admin")).toBe("@@admin");
  });
});
