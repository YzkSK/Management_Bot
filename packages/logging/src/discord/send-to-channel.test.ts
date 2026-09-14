import { describe, expect, mock, test } from "bun:test";
import type { FeatureModuleContext } from "@management-bot/core";
import { ContainerBuilder, MessageFlags, TextDisplayBuilder } from "discord.js";
import { createSendToChannel } from "./send-to-channel.js";

function fakeCtx(channel: { isTextBased: () => boolean; isSendable: () => boolean; send: ReturnType<typeof mock> } | null): FeatureModuleContext {
  return { client: { channels: { fetch: () => Promise.resolve(channel) } } } as unknown as FeatureModuleContext;
}

describe("createSendToChannel", () => {
  test("componentsが指定されていればComponents V2フラグを付けてcontentなしで送る", async () => {
    const send = mock(() => Promise.resolve());
    const ctx = fakeCtx({ isTextBased: () => true, isSendable: () => true, send });
    const container = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent("hi"));

    await createSendToChannel(ctx)("c1", { components: [container], suppressMentions: true });

    expect(send).toHaveBeenCalledWith({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { parse: [] },
    });
  });

  test("componentsがなければ従来通りcontentで送る", async () => {
    const send = mock(() => Promise.resolve());
    const ctx = fakeCtx({ isTextBased: () => true, isSendable: () => true, send });

    await createSendToChannel(ctx)("c1", { content: "text", suppressMentions: true });

    expect(send).toHaveBeenCalledWith({ content: "text", allowedMentions: { parse: [] } });
  });

  test("チャンネルが存在しない場合は例外を投げる", async () => {
    const ctx = fakeCtx(null);

    await expect(createSendToChannel(ctx)("c1", { content: "text", suppressMentions: true })).rejects.toThrow(
      "Channel c1 is not a sendable text-based channel",
    );
  });

  test("テキストベースでないチャンネルは例外を投げる", async () => {
    const send = mock(() => Promise.resolve());
    const ctx = fakeCtx({ isTextBased: () => false, isSendable: () => true, send });

    await expect(createSendToChannel(ctx)("c1", { content: "text", suppressMentions: true })).rejects.toThrow(
      "Channel c1 is not a sendable text-based channel",
    );
  });

  test("送信不可チャンネルは例外を投げる", async () => {
    const send = mock(() => Promise.resolve());
    const ctx = fakeCtx({ isTextBased: () => true, isSendable: () => false, send });

    await expect(createSendToChannel(ctx)("c1", { content: "text", suppressMentions: true })).rejects.toThrow(
      "Channel c1 is not a sendable text-based channel",
    );
  });
});
