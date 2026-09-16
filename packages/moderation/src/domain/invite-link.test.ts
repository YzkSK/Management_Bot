import { describe, expect, test } from "bun:test";
import { extractInviteCodes, hasInviteLinkHit } from "./invite-link.js";

describe("extractInviteCodes", () => {
  test("discord.gg/<code>から招待コードを抽出する", () => {
    expect(extractInviteCodes("join us: discord.gg/abc123")).toEqual(["abc123"]);
  });

  test("discord.com/invite/<code>から招待コードを抽出する", () => {
    expect(extractInviteCodes("https://discord.com/invite/abc123")).toEqual(["abc123"]);
  });

  test("discordapp.com/invite/<code>から招待コードを抽出する", () => {
    expect(extractInviteCodes("https://discordapp.com/invite/abc123")).toEqual(["abc123"]);
  });

  test("1メッセージ内の複数の招待リンクを全て抽出する", () => {
    expect(extractInviteCodes("discord.gg/aaa111 and discord.com/invite/bbb222")).toEqual(["aaa111", "bbb222"]);
  });

  test("同一コードの重複は除去する", () => {
    expect(extractInviteCodes("discord.gg/abc123 discord.gg/abc123")).toEqual(["abc123"]);
  });

  test("招待URLでないものは抽出しない", () => {
    expect(extractInviteCodes("check out https://example.com and discord.com (no invite path)")).toEqual([]);
  });

  test("招待リンクを含まないメッセージは空配列", () => {
    expect(extractInviteCodes("hello world")).toEqual([]);
  });
});

describe("hasInviteLinkHit", () => {
  test("全て自ギルドの招待ならfalse", () => {
    expect(hasInviteLinkHit([true, true])).toBe(false);
  });

  test("1件でも他ギルドの招待があればtrue", () => {
    expect(hasInviteLinkHit([true, false])).toBe(true);
  });

  test("解決結果が空ならfalse", () => {
    expect(hasInviteLinkHit([])).toBe(false);
  });
});
