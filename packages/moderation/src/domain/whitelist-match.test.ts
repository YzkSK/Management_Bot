import { describe, expect, test } from "bun:test";
import { isWhitelistMatch } from "./whitelist-match.js";

describe("isWhitelistMatch", () => {
  const guildId = "g1";

  test("ホワイトリストが空ならfalse", () => {
    expect(isWhitelistMatch([], guildId, "u1", [])).toBe(false);
  });

  test("targetType=userが一致するユーザーはtrue", () => {
    const entries = [{ targetType: "user" as const, targetId: "u1" }];
    expect(isWhitelistMatch(entries, guildId, "u1", [])).toBe(true);
    expect(isWhitelistMatch(entries, guildId, "u1-other", [])).toBe(false);
  });

  test("targetType=roleが一致するロールを持つユーザーはtrue", () => {
    const entries = [{ targetType: "role" as const, targetId: "r1" }];
    expect(isWhitelistMatch(entries, guildId, "u1", ["r1"])).toBe(true);
    expect(isWhitelistMatch(entries, guildId, "u1", ["r1-other"])).toBe(false);
  });

  test("@everyone(roleId===guildId)は一致対象から除外される", () => {
    const entries = [{ targetType: "role" as const, targetId: guildId }];
    expect(isWhitelistMatch(entries, guildId, "u1", [guildId])).toBe(false);
  });

  test("複数エントリのいずれかに一致すればtrue", () => {
    const entries = [
      { targetType: "user" as const, targetId: "u-other" },
      { targetType: "role" as const, targetId: "r1" },
    ];
    expect(isWhitelistMatch(entries, guildId, "u1", ["r1"])).toBe(true);
  });
});
