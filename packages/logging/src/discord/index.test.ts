import { describe, expect, mock, test } from "bun:test";
import type { DomainEventBus, FeatureModuleContext } from "@management-bot/core";
import type { Db } from "@management-bot/db";
import { createSendToChannel, registerDiscordHandlers } from "./index.js";

describe("registerDiscordHandlers", () => {
  test("moderation.action.recordedをlogging自身のeventBusで購読する", () => {
    const subscribe = mock(() => Promise.resolve());
    const eventBus = { subscribe } as unknown as DomainEventBus;
    const ctx = { client: {}, db: {} as Db, eventBus } as unknown as FeatureModuleContext;

    registerDiscordHandlers(ctx);

    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(subscribe.mock.calls[0]?.[0]).toBe("moderation.action.recorded");
  });
});

describe("createSendToChannel", () => {
  function fakeCtx(channel: unknown): FeatureModuleContext {
    return {
      client: { channels: { fetch: () => Promise.resolve(channel) } },
    } as unknown as FeatureModuleContext;
  }

  test("テキストベースかつ送信可能なチャンネルへメンション抑制付きで送信する", async () => {
    const send = mock(() => Promise.resolve());
    const channel = { isTextBased: () => true, isSendable: () => true, send };
    const sendToChannel = createSendToChannel(fakeCtx(channel));

    await sendToChannel("c1", { content: "hello", suppressMentions: true });

    expect(send).toHaveBeenCalledWith({ content: "hello", allowedMentions: { parse: [] } });
  });

  test("チャンネルが見つからない場合は何もしない", async () => {
    const sendToChannel = createSendToChannel(fakeCtx(null));
    await expect(sendToChannel("c1", { content: "hello", suppressMentions: true })).resolves.toBeUndefined();
  });

  test("テキストベースでないチャンネルには送信しない", async () => {
    const send = mock(() => Promise.resolve());
    const channel = { isTextBased: () => false, isSendable: () => true, send };
    const sendToChannel = createSendToChannel(fakeCtx(channel));

    await sendToChannel("c1", { content: "hello", suppressMentions: true });

    expect(send).not.toHaveBeenCalled();
  });

  test("送信不可(権限不足等)なチャンネルには送信しない", async () => {
    const send = mock(() => Promise.resolve());
    const channel = { isTextBased: () => true, isSendable: () => false, send };
    const sendToChannel = createSendToChannel(fakeCtx(channel));

    await sendToChannel("c1", { content: "hello", suppressMentions: true });

    expect(send).not.toHaveBeenCalled();
  });
});
