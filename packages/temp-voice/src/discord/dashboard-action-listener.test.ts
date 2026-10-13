import { describe, expect, mock, test } from "bun:test";
import { handleAutoSetupNotification, handleChannelActionNotification, handleForceDeleteNotification } from "./dashboard-action-listener.js";

/** multi().hset().expire().exec()の呼び出しを記録するfake redis。execが失敗するよう切り替えられる。 */
function fakeRedis(execError?: Error) {
  const calls: unknown[][] = [];
  const chain: { hset: (...args: unknown[]) => unknown; expire: (...args: unknown[]) => unknown; exec: () => Promise<unknown[]> } = {
    hset: (...args: unknown[]) => {
      calls.push(["hset", ...args]);
      return chain;
    },
    expire: (...args: unknown[]) => {
      calls.push(["expire", ...args]);
      return chain;
    },
    exec: () => (execError ? Promise.reject(execError) : Promise.resolve([])),
  };
  return { redis: { multi: () => chain }, calls };
}

describe("handleChannelActionNotification", () => {
  const notification = {
    requestId: "11111111-1111-4111-8111-111111111111",
    guildId: "g1",
    channelId: "c1",
    executorId: "u1",
    action: { type: "setHidden", hidden: true },
  } as const;
  const baseDeps = { client: {}, db: {}, eventBus: {}, tryReserveRenameSlot: () => true };

  const resultKey = `temp-voice:action-result:g1:${notification.requestId}`;

  test("通知をapplyDashboardActionへそのまま渡し、結果をrequestIdごとのキーに60秒TTLで書く", async () => {
    const apply = mock(async () => ({ ok: true }) as const);
    const { redis, calls } = fakeRedis();
    await handleChannelActionNotification({ ...baseDeps, redis, apply } as never, notification);
    expect(apply).toHaveBeenCalledWith(expect.anything(), notification);
    expect(calls).toEqual([
      ["hset", resultKey, "result", JSON.stringify({ ok: true })],
      ["expire", resultKey, 60],
    ]);
  });

  test("失敗結果はそのまま書く", async () => {
    const apply = mock(async () => ({ ok: false, reason: "rate_limited" }) as const);
    const { redis, calls } = fakeRedis();
    await handleChannelActionNotification({ ...baseDeps, redis, apply } as never, notification);
    expect(calls[0]).toEqual(["hset", resultKey, "result", JSON.stringify({ ok: false, reason: "rate_limited" })]);
  });

  test("applyが例外を投げたらdiscord_errorを書く", async () => {
    const apply = mock(async () => {
      throw new Error("Missing Permissions");
    });
    const { redis, calls } = fakeRedis();
    await handleChannelActionNotification({ ...baseDeps, redis, apply } as never, notification);
    expect(calls[0]).toEqual(["hset", resultKey, "result", JSON.stringify({ ok: false, reason: "discord_error" })]);
  });

  test("Redisへの書き込みに失敗しても例外を投げない", async () => {
    const apply = mock(async () => ({ ok: true }) as const);
    const { redis } = fakeRedis(new Error("redis down"));
    await handleChannelActionNotification({ ...baseDeps, redis, apply } as never, notification);
  });
});

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
