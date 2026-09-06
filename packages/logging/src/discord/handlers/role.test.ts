import { describe, expect, mock, test } from "bun:test";
import type { FeatureModuleContext } from "@management-bot/core";
import {
  registerRoleHandlers,
  toRoleCreateLogEntry,
  toRoleDeleteLogEntry,
  toRoleMembershipLogEntries,
  toRoleUpdateLogEntry,
} from "./role.js";

function fakeRole(id = "r1", overrides: Partial<Record<"name" | "color" | "hoist" | "mentionable" | "position", unknown>> = {}) {
  return {
    id,
    guild: { id: "g1" },
    name: "role",
    color: 0,
    hoist: false,
    mentionable: false,
    position: 0,
    permissions: { bitfield: 0n },
    ...overrides,
  } as never;
}

function fakeMember(roleIds: string[], id = "u1") {
  return { id, guild: { id: "g1" }, roles: { cache: new Map(roleIds.map((rid) => [rid, fakeRole(rid)])) } } as never;
}

describe("role category mappers", () => {
  test("create", () => expect(toRoleCreateLogEntry(fakeRole()).action).toBe("create"));
  test("update: 名前が変わればchangesに反映される", () => {
    const entry = toRoleUpdateLogEntry(fakeRole("r1", { name: "old" }), fakeRole("r1", { name: "new" }));
    expect(entry?.action).toBe("update");
    expect(entry).toMatchObject({ changes: { name: { before: "old", after: "new" } } });
  });
  test("update: 差分がなければnull(無関係ロールへの波及を記録しない)", () => {
    expect(toRoleUpdateLogEntry(fakeRole(), fakeRole())).toBeNull();
  });
  test("delete", () => expect(toRoleDeleteLogEntry(fakeRole()).action).toBe("delete"));
});

describe("toRoleMembershipLogEntries", () => {
  test("追加ロールはmemberAdd、剥奪ロールはmemberRemoveになり、対象メンバーのuserIdを含む", () => {
    const entries = toRoleMembershipLogEntries(fakeMember(["r1"], "u1"), fakeMember(["r2"], "u1"));
    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ roleId: "r2", userId: "u1", action: "memberAdd" }),
        expect.objectContaining({ roleId: "r1", userId: "u1", action: "memberRemove" }),
      ]),
    );
    expect(entries).toHaveLength(2);
  });

  test("ロール構成が変わらなければ空配列", () => {
    expect(toRoleMembershipLogEntries(fakeMember(["r1"]), fakeMember(["r1"]))).toEqual([]);
  });
});

describe("registerRoleHandlers", () => {
  test("必要な4イベントをclient.onに登録する", () => {
    const on = mock(() => undefined);
    const ctx = { client: { on }, db: {} } as unknown as FeatureModuleContext;

    registerRoleHandlers(ctx);

    const events = on.mock.calls.map((call) => call[0]);
    expect(events).toEqual(expect.arrayContaining(["roleCreate", "roleUpdate", "roleDelete", "guildMemberUpdate"]));
  });
});
