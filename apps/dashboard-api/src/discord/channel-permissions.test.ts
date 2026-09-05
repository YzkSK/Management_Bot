import { describe, expect, test } from "bun:test";
import { isChannelSendable } from "./channel-permissions.ts";

const VIEW_CHANNEL = 0x400n;
const SEND_MESSAGES = 0x800n;
const ADMINISTRATOR = 0x8n;

function baseInput(overrides: Partial<Parameters<typeof isChannelSendable>[0]> = {}) {
  return {
    guildId: "g1",
    botUserId: "bot1",
    botRoleIds: ["r1"],
    guildRoles: [
      { id: "g1", permissions: VIEW_CHANNEL | SEND_MESSAGES },
      { id: "r1", permissions: 0n },
    ],
    overwrites: [],
    ...overrides,
  };
}

describe("isChannelSendable", () => {
  test("overwriteが無ければ@everyoneのVIEW_CHANNEL/SEND_MESSAGESで送信可能", () => {
    expect(isChannelSendable(baseInput())).toBe(true);
  });

  test("@everyoneがSEND_MESSAGESを持たなければ送信不可", () => {
    expect(
      isChannelSendable(
        baseInput({ guildRoles: [{ id: "g1", permissions: VIEW_CHANNEL }, { id: "r1", permissions: 0n }] }),
      ),
    ).toBe(false);
  });

  test("@everyone overwriteでSEND_MESSAGESがdenyされていれば送信不可", () => {
    expect(
      isChannelSendable(
        baseInput({ overwrites: [{ id: "g1", type: 0, allow: 0n, deny: SEND_MESSAGES }] }),
      ),
    ).toBe(false);
  });

  test("botのロールoverwriteでSEND_MESSAGESがallowされていれば@everyoneのdenyを上書きして送信可能", () => {
    expect(
      isChannelSendable(
        baseInput({
          overwrites: [
            { id: "g1", type: 0, allow: 0n, deny: SEND_MESSAGES },
            { id: "r1", type: 0, allow: SEND_MESSAGES, deny: 0n },
          ],
        }),
      ),
    ).toBe(true);
  });

  test("botユーザー個別のoverwriteが最優先される", () => {
    expect(
      isChannelSendable(
        baseInput({
          overwrites: [
            { id: "r1", type: 0, allow: SEND_MESSAGES, deny: 0n },
            { id: "bot1", type: 1, allow: 0n, deny: SEND_MESSAGES },
          ],
        }),
      ),
    ).toBe(false);
  });

  test("ADMINISTRATORを持てばoverwriteに関わらず送信可能", () => {
    expect(
      isChannelSendable(
        baseInput({
          guildRoles: [
            { id: "g1", permissions: 0n },
            { id: "r1", permissions: ADMINISTRATOR },
          ],
          overwrites: [{ id: "r1", type: 0, allow: 0n, deny: SEND_MESSAGES }],
        }),
      ),
    ).toBe(true);
  });

  test("botが複数ロールを持つ場合、いずれかのロール権限を合算する", () => {
    expect(
      isChannelSendable(
        baseInput({
          botRoleIds: ["r1", "r2"],
          guildRoles: [
            { id: "g1", permissions: VIEW_CHANNEL },
            { id: "r1", permissions: 0n },
            { id: "r2", permissions: SEND_MESSAGES },
          ],
        }),
      ),
    ).toBe(true);
  });
});
