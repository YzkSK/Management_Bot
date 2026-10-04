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

  test("ホモグリフで偽装した招待URLからも大文字小文字を保ったままコードを抽出する(#556)", () => {
    expect(extractInviteCodes("dіscord.gg/AbC")).toEqual(["AbC"]);
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

  test("大文字小文字を区別せずマッチする(Codexレビュー指摘の回帰テスト)", () => {
    expect(extractInviteCodes("HTTPS://DISCORD.GG/ValidCode")).toEqual(["ValidCode"]);
  });

  test("別ドメインの一部(例: notdiscord.gg)は誤検知しない(Codexレビュー指摘の回帰テスト)", () => {
    expect(extractInviteCodes("notdiscord.gg/notAnInvite")).toEqual([]);
  });

  test("www.付きのドメインからも招待コードを抽出する(#370: link-spam.tsとの扱い統一)", () => {
    expect(extractInviteCodes("https://www.discord.gg/abc123")).toEqual(["abc123"]);
    expect(extractInviteCodes("www.discord.com/invite/abc123")).toEqual(["abc123"]);
    expect(extractInviteCodes("https://www.discordapp.com/invite/abc123")).toEqual(["abc123"]);
  });

  test.each([
    ["URLエンコードしたスラッシュ", "discord.gg%2FAbC123"],
    ["バックスラッシュ", "discord.gg\\AbC123"],
    ["ドット・スラッシュ前後の空白", "discord . gg / AbC123"],
    ["(.)によるドット表記", "discord(.)gg/AbC123"],
    ["[.]によるドット表記", "discord[.]gg/AbC123"],
    ["ゼロ幅文字の挿入", "disc​ord.gg/AbC123"],
    ["Markdownリンク", "[無料Nitro](https://discord.gg/AbC123)"],
    ["山括弧で埋め込み抑止", "<https://discord.gg/AbC123>"],
  ])("難読化した招待URLからも抽出する: %s(#557)", (_label, content) => {
    expect(extractInviteCodes(content)).toEqual(["AbC123"]);
  });

  test("難読化の正規化で通常の文章を招待と誤認しない(#557)", () => {
    expect(extractInviteCodes("discordはいいぞ。 gg / またね")).toEqual([]);
    expect(extractInviteCodes("100%20 達成")).toEqual([]);
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
