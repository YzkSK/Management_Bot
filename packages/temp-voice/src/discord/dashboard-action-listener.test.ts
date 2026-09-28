import { describe, expect, mock, test } from "bun:test";
import { handleAutoSetupNotification, handleForceDeleteNotification } from "./dashboard-action-listener.js";

describe("handleAutoSetupNotification", () => {
  test("guildが見つからない場合は何もしない", async () => {
    const client = { guilds: { cache: { get: () => undefined } } } as never;
    const db = {} as never;
    await handleAutoSetupNotification({ client, db }, { guildId: "missing" });
  });

  test("カテゴリ・作成用VCを作成しconfigをUPSERTする", async () => {
    const createdCategory = { id: "cat-new", type: 4 };
    const createdVc = { id: "vc-new" };
    const channelsCreate = mock(async (opts: { type: number }) => (opts.type === 4 ? createdCategory : createdVc));
    const guild = { id: "g1", channels: { create: channelsCreate } } as never;
    const client = { guilds: { cache: { get: () => guild } } } as never;
    const upsert = mock(async () => {});
    await handleAutoSetupNotification({ client, db: {} as never, upsertConfig: upsert }, { guildId: "g1" });

    expect(channelsCreate).toHaveBeenCalledTimes(2);
    expect(upsert).toHaveBeenCalledWith(expect.anything(), "g1", { createChannelId: "vc-new", categoryId: "cat-new" });
  });
});

describe("handleForceDeleteNotification", () => {
  test("guildが見つからない場合は何もしない", async () => {
    const client = { guilds: { cache: { get: () => undefined } } } as never;
    const forceDelete = mock(async () => "not_found" as const);
    await handleForceDeleteNotification({ client, db: {} as never, eventBus: {} as never, forceDelete }, { guildId: "missing", channelId: "c1" });
    expect(forceDelete).not.toHaveBeenCalled();
  });

  test("guildが見つかればforceDeleteを呼ぶ", async () => {
    const guild = { id: "g1" } as never;
    const client = { guilds: { cache: { get: () => guild } } } as never;
    const forceDelete = mock(async () => "deleted" as const);
    await handleForceDeleteNotification(
      { client, db: {} as never, eventBus: {} as never, forceDelete },
      { guildId: "g1", channelId: "c1" },
    );

    expect(forceDelete).toHaveBeenCalledWith(expect.anything(), guild, "c1", "dashboard");
  });
});
