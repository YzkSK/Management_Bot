import { describe, expect, test } from "bun:test";
import { EMPTY_ROLE_FILTER, filterRoles, type FilterableRole, type RoleFilterValue } from "./role-filter.js";

const SEND_MESSAGES = 1n << 11n;
const KICK_MEMBERS = 1n << 1n;
const ADMINISTRATOR = 1n << 3n;

function role(name: string, permissions: bigint, memberCount: number | null): FilterableRole {
  return { name, permissions: permissions.toString(), memberCount };
}

const everyone = role("@everyone", SEND_MESSAGES, null);
const member = role("Member", SEND_MESSAGES, 100);
const mod = role("Moderator", SEND_MESSAGES | KICK_MEMBERS, 5);
const admin = role("Admin", ADMINISTRATOR, 2);
const empty = role("Empty", 0n, 0);
const roles = [everyone, member, mod, admin, empty];

function names(result: FilterableRole[]): string[] {
  return result.map((r) => r.name);
}

function withFilter(patch: Partial<RoleFilterValue>): RoleFilterValue {
  return { ...EMPTY_ROLE_FILTER, ...patch };
}

describe("filterRoles", () => {
  test("条件なしなら全ロールをそのまま返す", () => {
    expect(filterRoles(roles, "", EMPTY_ROLE_FILTER)).toEqual(roles);
  });

  describe("名前", () => {
    test("大文字小文字を区別しない部分一致", () => {
      expect(names(filterRoles(roles, "MOD", EMPTY_ROLE_FILTER))).toEqual(["Moderator"]);
      expect(names(filterRoles(roles, "e", EMPTY_ROLE_FILTER))).toEqual(["@everyone", "Member", "Moderator", "Empty"]);
    });

    test("前後の空白は無視し、一致なしは空", () => {
      expect(names(filterRoles(roles, "  admin ", EMPTY_ROLE_FILTER))).toEqual(["Admin"]);
      expect(filterRoles(roles, "zzz", EMPTY_ROLE_FILTER)).toEqual([]);
    });
  });

  describe("権限", () => {
    test("選んだ権限をすべて持つロールだけ残す(管理者は全権限持ちとして扱う)", () => {
      expect(names(filterRoles(roles, "", withFilter({ permissionKeys: ["KickMembers"] })))).toEqual(["Moderator", "Admin"]);
      expect(names(filterRoles(roles, "", withFilter({ permissionKeys: ["SendMessages"] })))).toEqual([
        "@everyone",
        "Member",
        "Moderator",
        "Admin",
      ]);
    });

    test("複数選択はAND条件", () => {
      expect(names(filterRoles(roles, "", withFilter({ permissionKeys: ["SendMessages", "KickMembers"] })))).toEqual([
        "Moderator",
        "Admin",
      ]);
    });

    test("管理者権限そのものを選ぶと管理者ロールだけ残る", () => {
      expect(names(filterRoles(roles, "", withFilter({ permissionKeys: ["Administrator"] })))).toEqual(["Admin"]);
    });

    test("未知のキーは無視される", () => {
      expect(filterRoles(roles, "", withFilter({ permissionKeys: ["Unknown"] }))).toEqual(roles);
    });
  });

  describe("メンバー数", () => {
    test("下限のみ(含む)。メンバー数不明のロールは除外", () => {
      expect(names(filterRoles(roles, "", withFilter({ minMembers: "5" })))).toEqual(["Member", "Moderator"]);
    });

    test("上限のみ(含む)。メンバー数不明のロールは除外", () => {
      expect(names(filterRoles(roles, "", withFilter({ maxMembers: "2" })))).toEqual(["Admin", "Empty"]);
    });

    test("下限と上限の範囲(両端を含む)", () => {
      expect(names(filterRoles(roles, "", withFilter({ minMembers: "2", maxMembers: "5" })))).toEqual(["Moderator", "Admin"]);
    });

    test("0人のロールは下限0で残る", () => {
      expect(names(filterRoles(roles, "", withFilter({ minMembers: "0", maxMembers: "0" })))).toEqual(["Empty"]);
    });

    test("空文字・数値でない入力は指定なし扱いで、不明なロールも除外しない", () => {
      expect(filterRoles(roles, "", withFilter({ minMembers: "", maxMembers: "abc" }))).toEqual(roles);
    });
  });

  test("名前・権限・メンバー数の複合条件", () => {
    const result = filterRoles(roles, "m", withFilter({ permissionKeys: ["SendMessages"], minMembers: "10" }));
    expect(names(result)).toEqual(["Member"]);
    expect(names(filterRoles(roles, "m", withFilter({ permissionKeys: ["KickMembers"], maxMembers: "10" })))).toEqual([
      "Moderator",
      "Admin",
    ]);
  });
});
