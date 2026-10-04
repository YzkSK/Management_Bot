import { describe, expect, test } from "bun:test";
import { foldConfusables } from "./confusables.js";

describe("foldConfusables", () => {
  test("ホモグリフをラテン文字へ寄せる", () => {
    expect(foldConfusables("dіscord.gg/abc")).toBe("discord.gg/abc");
    expect(foldConfusables("𝐝𝐢𝐬𝐜𝐨𝐫𝐝")).toBe("discord");
    expect(foldConfusables("ⅾіѕсоrd")).toBe("discord");
    expect(foldConfusables("café")).toBe("cafe");
  });

  test("日本語の仮名・漢字は変換しない", () => {
    for (const word of ["ロリ", "エロ", "バカ", "死ね", "タヒね", "ひらがな", "ー"]) {
      expect(foldConfusables(word)).toBe(word);
    }
  });

  test("ASCII(大文字小文字・LEET記号)と絵文字は変換しない", () => {
    expect(foldConfusables("AbC-xYz_09")).toBe("AbC-xYz_09");
    expect(foldConfusables("@$!+|")).toBe("@$!+|");
    expect(foldConfusables("hello 😀")).toBe("hello 😀");
  });
});
