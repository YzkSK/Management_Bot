import { describe, expect, test } from "bun:test";
import { buildInviteUrl } from "./invite-url.ts";

describe("buildInviteUrl", () => {
  test("bot applications.commandsスコープ・無権限でclient_idを含むURLを生成する", () => {
    const url = new URL(buildInviteUrl("123456"));

    expect(url.origin).toBe("https://discord.com");
    expect(url.searchParams.get("client_id")).toBe("123456");
    expect(url.searchParams.get("scope")).toBe("bot applications.commands");
    expect(url.searchParams.get("permissions")).toBe("0");
  });

  test("permissionsを指定すると再認可用の権限ビットフィールドを含むURLを生成する", () => {
    const url = new URL(buildInviteUrl("123456", 16n));

    expect(url.searchParams.get("permissions")).toBe("16");
  });

  test("guildIdを指定するとguild_id/disable_guild_selectを含み対象guildを固定する", () => {
    const url = new URL(buildInviteUrl("123456", 16n, { guildId: "guild-1" }));

    expect(url.searchParams.get("guild_id")).toBe("guild-1");
    expect(url.searchParams.get("disable_guild_select")).toBe("true");
  });

  test("guildId未指定ではguild_id/disable_guild_selectを含まない", () => {
    const url = new URL(buildInviteUrl("123456"));

    expect(url.searchParams.has("guild_id")).toBe(false);
    expect(url.searchParams.has("disable_guild_select")).toBe(false);
  });
});
