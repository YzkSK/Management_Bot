import { describe, expect, mock, test } from "bun:test";
import type { FeatureModuleContext } from "@management-bot/core";
import {
  registerRoleHandlers,
  toRoleCreateLogEntry,
  toRoleDeleteLogEntry,
  toRoleMembershipLogEntries,
  toRoleUpdateLogEntry,
} from "./role.js";

function fakeRole(id = "r1") {
  return { id, guild: { id: "g1" } } as never;
}

function fakeMember(roleIds: string[], id = "u1") {
  return { id, guild: { id: "g1" }, roles: { cache: new Map(roleIds.map((rid) => [rid, fakeRole(rid)])) } } as never;
}

describe("role category mappers", () => {
  test("create", () => expect(toRoleCreateLogEntry(fakeRole()).action).toBe("create"));
  test("update", () => expect(toRoleUpdateLogEntry(fakeRole(), fakeRole()).action).toBe("update"));
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
