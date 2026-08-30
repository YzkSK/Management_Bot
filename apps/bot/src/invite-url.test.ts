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
});
