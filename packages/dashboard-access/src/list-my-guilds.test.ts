import { describe, expect, test } from "bun:test";
import { isManagedGuild } from "./list-my-guilds.js";

describe("isManagedGuild", () => {
  test("オーナーならtrue", () => {
    expect(isManagedGuild({ owner: true, permissions: "0" })).toBe(true);
  });

  test("MANAGE_GUILD(0x20)ビットを持てばtrue", () => {
    expect(isManagedGuild({ owner: false, permissions: String(0x20) })).toBe(true);
  });

  test("MANAGE_GUILDを含む複合ビットマスクでもtrue", () => {
    expect(isManagedGuild({ owner: false, permissions: String(0x20 | 0x8) })).toBe(true);
  });

  test("オーナーでもMANAGE_GUILDでもなければfalse", () => {
    expect(isManagedGuild({ owner: false, permissions: String(0x8) })).toBe(false);
  });

  test("permissionsが0ならfalse", () => {
    expect(isManagedGuild({ owner: false, permissions: "0" })).toBe(false);
  });
});
