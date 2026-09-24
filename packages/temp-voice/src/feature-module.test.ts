import { describe, expect, mock, test } from "bun:test";
import { BotClient, type DomainEventBus, type FeatureModuleContext } from "@management-bot/core";
import type { Db } from "@management-bot/db";
import { ChannelType } from "discord.js";
import { tempVoiceFeatureModule } from "./feature-module.js";

describe("tempVoiceFeatureModule", () => {
  test("keyがtemp-voiceである", () => {
    expect(tempVoiceFeatureModule.key).toBe("temp-voice");
  });

  test("registerDiscordHandlersはvoiceStateUpdateハンドラを登録しエラーなく実行できる", async () => {
    const client = new BotClient();
    const on = mock(() => client);
    (client as unknown as { on: typeof on }).on = on;
    const ctx: FeatureModuleContext = {
      client,
      db: {} as Db,
      databaseUrl: "postgres://invalid-test-host/db",
      redisUrl: "redis://invalid-test-host",
      eventBus: {} as DomainEventBus,
      onShutdown: () => {},
    };

    await expect(Promise.resolve(tempVoiceFeatureModule.registerDiscordHandlers(ctx))).resolves.toBeUndefined();
    expect(on).toHaveBeenCalledWith("voiceStateUpdate", expect.any(Function));
  });

  test("channelDelete: 追跡対象外チャンネルの削除は何もしない(#414)", async () => {
    const client = new BotClient();
    const handlers = new Map<string, (...args: never[]) => unknown>();
    const on = mock((event: string, handler: (...args: never[]) => unknown) => {
      handlers.set(event, handler);
      return client;
    });
    (client as unknown as { on: typeof on }).on = on;
    const publish = mock(() => Promise.resolve());
    const ctx: FeatureModuleContext = {
      client,
      db: {} as Db,
      databaseUrl: "postgres://invalid-test-host/db",
      redisUrl: "redis://invalid-test-host",
      eventBus: { publish } as unknown as DomainEventBus,
      onShutdown: () => {},
    };

    tempVoiceFeatureModule.registerDiscordHandlers(ctx);
    expect(on).toHaveBeenCalledWith("channelDelete", expect.any(Function));

    const channelDeleteHandler = handlers.get("channelDelete");
    await channelDeleteHandler?.(
      {
        id: "untracked-channel",
        guildId: "g1",
        isDMBased: () => false,
      } as never,
    );

    expect(publish).not.toHaveBeenCalled();
  });

  test("channelDelete: 追跡中の一時VCが削除されたら残存セッションの終了イベントをpublishする(#414)", async () => {
    const client = new BotClient();
    const handlers = new Map<string, (...args: never[]) => unknown>();
    const on = mock((event: string, handler: (...args: never[]) => unknown) => {
      handlers.set(event, handler);
      return client;
    });
    (client as unknown as { on: typeof on }).on = on;
    const publish = mock(() => Promise.resolve());

    const CONFIG_ROW = {
      guildId: "g1",
      createChannelId: "create-ch",
      categoryId: "cat-1",
      nameTemplate: "{username}のVC",
      defaultUserLimit: 5,
      defaultBitrate: 96000,
    };
    let selectCallCount = 0;
    const db = {
      select: () => ({
        from: () => ({
          where: () => {
            selectCallCount += 1;
            // 1回目=getTempVoiceConfig、2回目=findOwnedTempVoiceChannelId(既存VCなし)。
            return Promise.resolve(selectCallCount === 1 ? [CONFIG_ROW] : []);
          },
        }),
      }),
      insert: () => ({ values: () => Promise.resolve() }),
      delete: () => ({ where: () => Promise.resolve() }),
    } as unknown as Db;

    const voiceChannel = {
      id: "vc-1",
      userLimit: 5,
      bitrate: 96000,
      permissionOverwrites: { cache: { get: () => undefined } },
      delete: mock(() => Promise.resolve()),
    };
    const controlChannel = {
      id: "ctrl-1",
      send: mock(() => Promise.resolve({ pin: () => Promise.resolve() })),
      delete: mock(() => Promise.resolve()),
    };
    const guild = {
      id: "g1",
      roles: { everyone: { id: "everyone-role" } },
      members: { me: { id: "bot-id" } },
      client: { user: { id: "bot-id" } },
      channels: {
        cache: { get: mock(() => undefined), filter: mock(() => ({ size: 0 })) },
        create: mock((options: { type: ChannelType }) =>
          Promise.resolve(options.type === ChannelType.GuildVoice ? { ...voiceChannel, guild } : { ...controlChannel, guild }),
        ),
        fetch: mock(() => Promise.resolve(null)),
      },
    };
    const member = { id: "owner-1", displayName: "太郎", voice: { setChannel: mock(() => Promise.resolve()) } };

    const ctx: FeatureModuleContext = {
      client,
      db,
      databaseUrl: "postgres://invalid-test-host/db",
      redisUrl: "redis://invalid-test-host",
      eventBus: { publish } as unknown as DomainEventBus,
      onShutdown: () => {},
    };

    tempVoiceFeatureModule.registerDiscordHandlers(ctx);
    const voiceStateUpdateHandler = handlers.get("voiceStateUpdate");
    const newState = { guild, member, channelId: "create-ch", id: member.id } as never;
    await voiceStateUpdateHandler?.({ channelId: null } as never, newState);
    // handleVoiceCreate内のVC作成～DB INSERTは非同期でfire-and-forgetされるため完了を待つ。
    await new Promise((resolve) => setTimeout(resolve, 0));

    const channelDeleteHandler = handlers.get("channelDelete");
    await channelDeleteHandler?.({ id: "vc-1", guildId: "g1", isDMBased: () => false } as never);

    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: "voice.session.ended", channelId: "vc-1", userId: "owner-1" }));
  });
});
