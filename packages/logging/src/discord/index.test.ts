import { describe, expect, mock, test } from "bun:test";
import type { DomainEventBus, FeatureModuleContext } from "@management-bot/core";
import type { Db } from "@management-bot/db";
import { createSendToChannel, registerDiscordHandlers } from "./index.js";

describe("registerDiscordHandlers", () => {
  test("moderation.action.recordedをlogging自身のeventBusで購読する", async () => {
    const subscribe = mock(() => Promise.resolve());
    const eventBus = { subscribe } as unknown as DomainEventBus;
    const on = mock(() => undefined);
    const ctx = { client: { on }, db: {} as Db, eventBus } as unknown as FeatureModuleContext;

    await registerDiscordHandlers(ctx);

    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(subscribe.mock.calls[0]?.[0]).toBe("moderation.action.recorded");
  });

  test("eventBus.subscribeが失敗したら呼び出し元に伝播する(BotClient.registerFeaturesが起動失敗として検知できるように)", async () => {
    const subscribe = mock(() => Promise.reject(new Error("BUSYGROUP")));
    const eventBus = { subscribe } as unknown as DomainEventBus;
    const on = mock(() => undefined);
    const ctx = { client: { on }, db: {} as Db, eventBus } as unknown as FeatureModuleContext;

    await expect(registerDiscordHandlers(ctx)).rejects.toThrow("BUSYGROUP");
  });

  test("message/member/role/channelの各カテゴリハンドラを登録する", async () => {
    const subscribe = mock(() => Promise.resolve());
    const eventBus = { subscribe } as unknown as DomainEventBus;
    const on = mock(() => undefined);
    const ctx = { client: { on }, db: {} as Db, eventBus } as unknown as FeatureModuleContext;

    await registerDiscordHandlers(ctx);

    const events = on.mock.calls.map((call) => call[0]);
    expect(events).toEqual(
      expect.arrayContaining([
        "messageCreate",
        "guildMemberAdd",
        "roleCreate",
        "channelCreate",
        "guildUpdate",
        "threadCreate",
        "inviteCreate",
        "emojiCreate",
        "autoModerationRuleCreate",
        "guildScheduledEventCreate",
        "stageInstanceCreate",
      ]),
    );
  });

  test("messageCreate/messageUpdateはmessage用・poll用の両方から登録される", async () => {
    const subscribe = mock(() => Promise.resolve());
    const eventBus = { subscribe } as unknown as DomainEventBus;
    const on = mock(() => undefined);
    const ctx = { client: { on }, db: {} as Db, eventBus } as unknown as FeatureModuleContext;

    await registerDiscordHandlers(ctx);

    const countOf = (event: string) => on.mock.calls.filter(([registered]) => registered === event).length;
    expect(countOf("messageCreate")).toBe(2);
    expect(countOf("messageUpdate")).toBe(2);
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

  test("チャンネルが見つからない場合は例外を投げる(silentに握りつぶすと再配送されずログが欠落するため)", async () => {
    const sendToChannel = createSendToChannel(fakeCtx(null));
    await expect(sendToChannel("c1", { content: "hello", suppressMentions: true })).rejects.toThrow();
  });

  test("テキストベースでないチャンネルには例外を投げる", async () => {
    const send = mock(() => Promise.resolve());
    const channel = { isTextBased: () => false, isSendable: () => true, send };
    const sendToChannel = createSendToChannel(fakeCtx(channel));

    await expect(sendToChannel("c1", { content: "hello", suppressMentions: true })).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });

  test("送信不可(権限不足等)なチャンネルには例外を投げる", async () => {
    const send = mock(() => Promise.resolve());
    const channel = { isTextBased: () => true, isSendable: () => false, send };
    const sendToChannel = createSendToChannel(fakeCtx(channel));

    await expect(sendToChannel("c1", { content: "hello", suppressMentions: true })).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });
});
