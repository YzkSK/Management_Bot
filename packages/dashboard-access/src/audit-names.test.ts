import { describe, expect, test } from "bun:test";
import { collectAuditIds, resolveAuditNames } from "./audit-names.js";

const CHANNEL = "111111111111111111";
const ROLE = "222222222222222222";
const USER = "333333333333333333";
const GUILD = "999999999999999999";

describe("collectAuditIds", () => {
  test("ID用のキーの値だけを集め、guildIdや非IDの値は拾わない", () => {
    const ids = collectAuditIds([
      { guildId: GUILD, channelId: CHANNEL, roleIds: [ROLE], nameTemplate: "VC", category: "message" },
      [{ category: "message", channelId: CHANNEL }],
      null,
    ]);
    expect(new Set(ids)).toEqual(new Set([CHANNEL, ROLE]));
  });

  test("キー無しのID配列(拒否禁止ロールの変更前)も拾う。ID形式でない文字列は拾わない", () => {
    expect(new Set(collectAuditIds([[ROLE, "not-an-id"], { userId: "x" }]))).toEqual(new Set([ROLE]));
  });
});

describe("resolveAuditNames", () => {
  const ctx = {
    getAllGuildChannels: async () => [{ id: CHANNEL, name: "general" }],
    getGuildRoles: async () => [{ id: ROLE, name: "moderator" }],
    getGuildMemberNames: async (_guildId: string, ids: readonly string[]) =>
      new Map(ids.filter((id) => id === USER).map((id) => [id, "yuzuki"])),
  };

  test("チャンネル・ロール・メンバーの順に名前を解決し、解決できないIDは含めない", async () => {
    const names = await resolveAuditNames(ctx, GUILD, [CHANNEL, ROLE, USER, "444444444444444444"]);
    expect(names).toEqual({ [CHANNEL]: "general", [ROLE]: "moderator", [USER]: "yuzuki" });
  });

  test("取得に失敗しても例外にせず、解決できた分だけ返す", async () => {
    const names = await resolveAuditNames(
      {
        ...ctx,
        getAllGuildChannels: async () => {
          throw new Error("boom");
        },
        getGuildMemberNames: async () => {
          throw new Error("boom");
        },
      },
      GUILD,
      [CHANNEL, ROLE],
    );
    expect(names).toEqual({ [ROLE]: "moderator" });
  });

  test("IDが無ければ何も問い合わせない", async () => {
    expect(await resolveAuditNames(ctx, GUILD, [])).toEqual({});
  });
});
