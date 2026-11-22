import { describe, expect, test } from "bun:test";
import { listRoles } from "./list-roles.js";

describe("listRoles", () => {
  test("取得できなければ空一覧(メンバー数なし)", async () => {
    expect(await listRoles({ getGuildRoleList: async () => null }, "1")).toEqual({
      roles: [],
      memberCountsAvailable: false,
    });
  });

  test("memberCountsがnullならmemberCountsAvailable=false・各memberCountはnull", async () => {
    const result = await listRoles(
      {
        getGuildRoleList: async () => ({
          roles: [{ id: "2", name: "a", color: 0, position: 1, permissions: "0", managed: false, botId: null }],
          memberCounts: null,
          botRoleIds: [],
        }),
      },
      "1",
    );

    expect(result.memberCountsAvailable).toBe(false);
    expect(result.roles[0]?.memberCount).toBeNull();
  });
});
