import { describe, expect, test } from "bun:test";
import { buildTransferOwnerMessage, buildTransferOwnerSelectCustomId, parseTransferOwnerSelectCustomId } from "./transfer-owner-message.js";

function fakeMember(id: string) {
  return { id, displayName: `member-${id}` } as never;
}

describe("buildTransferOwnerSelectCustomId / parseTransferOwnerSelectCustomId", () => {
  test("customIdを組み立ててパースするとchannelIdが復元できる", () => {
    const customId = buildTransferOwnerSelectCustomId("channel-1", 0);
    expect(customId).toBe("temp-voice:transferOwnerUser:channel-1:0");
    expect(parseTransferOwnerSelectCustomId(customId)).toEqual({ channelId: "channel-1" });
  });

  test("prefixが違うcustomIdはnullを返す", () => {
    expect(parseTransferOwnerSelectCustomId("other:transferOwnerUser:channel-1:0")).toBeNull();
  });
});

describe("buildTransferOwnerMessage", () => {
  test("VC内にメンバーがいなければ案内メッセージを返す", () => {
    const message = buildTransferOwnerMessage("channel-1", []);
    const text = JSON.stringify(message);
    expect(text).toContain("移譲先にできるメンバーがVC内にいません");
  });

  test("25人以下ならメニューは1つだけ生成される", () => {
    const members = Array.from({ length: 20 }, (_, i) => fakeMember(`u${i}`));
    const message = buildTransferOwnerMessage("channel-1", members);
    const text = JSON.stringify(message);
    expect((text.match(/transferOwnerUser:channel-1:/g) ?? []).length).toBe(1);
  });

  test("26人以上いる場合は複数のStringSelectMenuに分割する(codexレビュー指摘: 25人超過時に26人目以降が選択できなくなっていた)", () => {
    const members = Array.from({ length: 30 }, (_, i) => fakeMember(`u${i}`));
    const message = buildTransferOwnerMessage("channel-1", members);
    const text = JSON.stringify(message);

    expect(text).toContain("u29");
    expect((text.match(/transferOwnerUser:channel-1:/g) ?? []).length).toBe(2);
  });

  test("125人を超える場合は先頭125人のみ表示する(Discordの1メッセージ25選択肢×5ActionRow上限)", () => {
    const members = Array.from({ length: 150 }, (_, i) => fakeMember(`u${i}`));
    const message = buildTransferOwnerMessage("channel-1", members);
    const text = JSON.stringify(message);

    expect(text).toContain("u124");
    expect(text).not.toContain("u125");
  });
});
