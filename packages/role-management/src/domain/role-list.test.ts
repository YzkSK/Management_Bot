import { describe, expect, test } from "bun:test";
import { buildRoleListItems, type RoleListSourceRole } from "./role-list.js";

const guildId = "100";

function role(overrides: Partial<RoleListSourceRole> & { id: string }): RoleListSourceRole {
  return { name: overrides.id, color: 0, position: 1, permissions: "0", managed: false, botId: null, ...overrides };
}

describe("buildRoleListItems", () => {
  test("position降順に並べ、同順位はid昇順(桁数→辞書順)で並べる", () => {
    const items = buildRoleListItems({
      guildId,
      roles: [
        role({ id: "9", position: 2 }),
        role({ id: "100", position: 0 }),
        role({ id: "10", position: 2 }),
        role({ id: "5", position: 5 }),
      ],
      memberCounts: null,
      botRoleIds: [],
    });

    expect(items.map((i) => i.id)).toEqual(["5", "9", "10", "100"]);
  });

  test("@everyoneはisEveryone=true・memberCount=null・操作不可", () => {
    const [item] = buildRoleListItems({
      guildId,
      roles: [role({ id: guildId, position: 0 })],
      memberCounts: { [guildId]: 50 },
      botRoleIds: ["bot-role"],
    });

    expect(item).toMatchObject({ isEveryone: true, memberCount: null, botManageable: false });
  });

  test("memberCounts: 取得できたロールは件数、未掲載は0、取得不可(null)ならnull", () => {
    const roles = [role({ id: "1" }), role({ id: "2" })];

    const withCounts = buildRoleListItems({ guildId, roles, memberCounts: { "1": 7 }, botRoleIds: [] });
    expect(withCounts.map((i) => [i.id, i.memberCount])).toEqual([
      ["1", 7],
      ["2", 0],
    ]);

    const without = buildRoleListItems({ guildId, roles, memberCounts: null, botRoleIds: [] });
    expect(without.every((i) => i.memberCount === null)).toBe(true);
  });

  test("botManageable: Botの最上位ロールより低く、managedでないロールのみtrue", () => {
    const items = buildRoleListItems({
      guildId,
      roles: [
        role({ id: "bot-role", position: 5, managed: true, botId: "bot1" }),
        role({ id: "above", position: 6 }),
        role({ id: "same", position: 5 }),
        role({ id: "below", position: 4 }),
        role({ id: "integration", position: 3, managed: true }),
      ],
      memberCounts: null,
      botRoleIds: ["bot-role"],
    });
    const manageable = Object.fromEntries(items.map((i) => [i.id, i.botManageable]));

    expect(manageable).toEqual({
      above: false,
      "bot-role": false,
      same: false,
      below: true,
      integration: false,
    });
  });

  test("Botがロールを持たなければ(最上位position 0)どのロールも操作不可", () => {
    const items = buildRoleListItems({
      guildId,
      roles: [role({ id: "1", position: 1 }), role({ id: "2", position: 0 })],
      memberCounts: null,
      botRoleIds: [],
    });

    expect(items.every((i) => !i.botManageable)).toBe(true);
  });

  test("botIdとpermissionsはそのまま引き継ぐ", () => {
    const [item] = buildRoleListItems({
      guildId,
      roles: [role({ id: "1", permissions: "8", botId: "b1" })],
      memberCounts: null,
      botRoleIds: [],
    });

    expect(item).toMatchObject({ permissions: "8", botId: "b1" });
  });
});
