import { describe, expect, mock, test } from "bun:test";
import type { TempVoiceChannelActionNotification } from "@management-bot/db";
import { applyDashboardAction, type ApplyDashboardActionDeps } from "./apply-dashboard-action.js";

const ROW = { channelId: "vc-1", guildId: "g1", controlChannelId: "ctrl-1", ownerId: "owner-1" };

/** findTempVoiceChannel(select→from→where)とoverrideのinsert/delete、保護ロール判定(select)を賄う最小のfake。 */
function fakeDb(row: typeof ROW | null, protectedRoleIds: string[] = []) {
  const upsertCalls: unknown[] = [];
  const deleteCalls: unknown[] = [];
  let selectCount = 0;
  return {
    upsertCalls,
    deleteCalls,
    /** applyDashboardAction1回ごとに、最初のselect(findTempVoiceChannel)から数え直す。 */
    reset: () => {
      selectCount = 0;
    },
    db: {
      select: () => ({
        from: () => ({
          where: () => {
            selectCount++;
            // 1回目: findTempVoiceChannel、以降: isDenyProtectedRole / findOwnedTempVoiceChannelId。
            if (selectCount === 1) return Promise.resolve(row ? [row] : []);
            return Object.assign(Promise.resolve(protectedRoleIds.map((roleId) => ({ roleId }))), {
              limit: () => Promise.resolve(protectedRoleIds.map((roleId) => ({ roleId }))),
            });
          },
        }),
      }),
      insert: () => ({
        values: (v: unknown) => {
          upsertCalls.push(v);
          return { onConflictDoUpdate: () => Promise.resolve() };
        },
      }),
      delete: () => ({
        where: (w: unknown) => {
          deleteCalls.push(w);
          return Promise.resolve();
        },
      }),
    },
  };
}

function fakeVoiceChannel() {
  const channel: Record<string, unknown> = {
    id: "vc-1",
    name: "太郎のVC",
    userLimit: 5,
    bitrate: 96000,
    members: new Map(),
    guild: { roles: { everyone: { id: "everyone-id" } }, client: { user: { id: "bot" } } },
    permissionOverwrites: { cache: { get: () => undefined }, edit: mock(() => Promise.resolve(channel)) },
    isVoiceBased: () => true,
    setName: mock(() => Promise.resolve(channel)),
    setUserLimit: mock(() => Promise.resolve(channel)),
    setBitrate: mock(() => Promise.resolve(channel)),
  };
  return channel as Record<string, unknown> & {
    setName: ReturnType<typeof mock>;
    setUserLimit: ReturnType<typeof mock>;
    setBitrate: ReturnType<typeof mock>;
    permissionOverwrites: { edit: ReturnType<typeof mock> };
    members: Map<string, unknown>;
  };
}

function setup(options: { row?: typeof ROW | null; protectedRoleIds?: string[]; reserve?: boolean; guildMissing?: boolean } = {}) {
  const voiceChannel = fakeVoiceChannel();
  const publish = mock(() => Promise.resolve());
  const { db, upsertCalls, deleteCalls, reset } = fakeDb(options.row === undefined ? ROW : options.row, options.protectedRoleIds);
  const guild = {
    id: "g1",
    maximumBitrate: 128_000,
    channels: { cache: { get: (id: string) => (id === "vc-1" ? voiceChannel : undefined) } },
    members: { cache: { get: () => undefined } },
    roles: { cache: { get: () => undefined } },
  };
  const client = {
    guilds: { cache: { get: () => (options.guildMissing ? undefined : guild) } },
    channels: { cache: { get: () => undefined } },
  };
  const deps = {
    client,
    db,
    eventBus: { publish },
    tryReserveRenameSlot: () => options.reserve ?? true,
  } as unknown as ApplyDashboardActionDeps;
  const run = (action: TempVoiceChannelActionNotification["action"]) => {
    reset();
    return applyDashboardAction(deps, { guildId: "g1", channelId: "vc-1", executorId: "owner-1", action });
  };
  return { voiceChannel, publish, upsertCalls, deleteCalls, run };
}

describe("applyDashboardAction", () => {
  test("VCまたはギルドが存在しなければ何もしない", async () => {
    const a = setup({ row: null });
    await a.run({ type: "rename", name: "x" });
    expect(a.voiceChannel.setName).not.toHaveBeenCalled();
    const b = setup({ guildMissing: true });
    await b.run({ type: "rename", name: "x" });
    expect(b.voiceChannel.setName).not.toHaveBeenCalled();
  });

  test("rename: 検証してVCを改名しイベントを発行する", async () => {
    const t = setup();
    await t.run({ type: "rename", name: " 新しい名前 " });
    expect(t.voiceChannel.setName).toHaveBeenCalledWith("新しい名前", expect.any(String));
    expect(t.publish).toHaveBeenCalledWith(expect.objectContaining({ action: "renamed", before: "太郎のVC", after: "新しい名前", executorId: "owner-1" }));
  });

  test("rename: レート制限超過・不正な名前ではAPIを呼ばない(ログのみ)", async () => {
    const limited = setup({ reserve: false });
    await limited.run({ type: "rename", name: "新しい名前" });
    expect(limited.voiceChannel.setName).not.toHaveBeenCalled();
    const invalid = setup();
    await invalid.run({ type: "rename", name: "   " });
    expect(invalid.voiceChannel.setName).not.toHaveBeenCalled();
    expect(invalid.publish).not.toHaveBeenCalled();
  });

  test("userLimit / bitrate: 検証後に反映し、範囲外は無視する", async () => {
    const t = setup();
    await t.run({ type: "userLimit", value: 10 });
    await t.run({ type: "userLimit", value: 100 });
    expect(t.voiceChannel.setUserLimit).toHaveBeenCalledTimes(1);
    expect(t.voiceChannel.setUserLimit).toHaveBeenCalledWith(10, expect.any(String));
    await t.run({ type: "bitrate", kbps: 64 });
    await t.run({ type: "bitrate", kbps: 500 });
    expect(t.voiceChannel.setBitrate).toHaveBeenCalledTimes(1);
    expect(t.voiceChannel.setBitrate).toHaveBeenCalledWith(64_000, expect.any(String));
  });

  test("setLocked: オーナーの個別許可を先に付与してから@everyoneのConnectを拒否する。既に同状態なら何もしない", async () => {
    const t = setup();
    await t.run({ type: "setLocked", locked: true });
    const calls = t.voiceChannel.permissionOverwrites.edit.mock.calls as unknown as [string, Record<string, unknown>][];
    expect(calls[0]).toEqual(["owner-1", { Connect: true, ViewChannel: true }, expect.anything()]);
    expect(calls.at(-1)).toEqual(["everyone-id", { Connect: false }, expect.anything()]);
    expect(t.publish).toHaveBeenCalledWith(expect.objectContaining({ action: "permissionChanged", permission: "connect", allowed: false }));

    const idempotent = setup();
    await idempotent.run({ type: "setLocked", locked: false });
    expect(idempotent.voiceChannel.permissionOverwrites.edit).not.toHaveBeenCalled();
  });

  test("permit: overwriteを付与しDBへ登録、deny: 保護ロールは拒否しない", async () => {
    const t = setup();
    await t.run({ type: "permit", targetType: "user", targetId: "u2" });
    expect(t.voiceChannel.permissionOverwrites.edit).toHaveBeenCalledWith("u2", { Connect: true }, expect.anything());
    expect(t.upsertCalls).toEqual([{ channelId: "vc-1", targetType: "user", targetId: "u2", state: "allow" }]);
    expect(t.publish).toHaveBeenCalledWith(expect.objectContaining({ action: "memberPermissionChanged", state: "allow", targetId: "u2" }));

    const protectedRole = setup({ protectedRoleIds: ["r1"] });
    await protectedRole.run({ type: "deny", targetType: "role", targetId: "r1" });
    expect(protectedRole.voiceChannel.permissionOverwrites.edit).not.toHaveBeenCalled();
    expect(protectedRole.upsertCalls).toEqual([]);
  });

  test("removeOverride: Connectキーのみクリアし、DBから削除する", async () => {
    const t = setup();
    await t.run({ type: "removeOverride", targetType: "role", targetId: "r1" });
    expect(t.voiceChannel.permissionOverwrites.edit).toHaveBeenCalledWith("r1", { Connect: null }, expect.anything());
    expect(t.deleteCalls).toHaveLength(1);
    expect(t.publish).toHaveBeenCalledWith(expect.objectContaining({ state: "cleared", targetType: "role" }));
  });

  test("transferOwner: 在室していないメンバーへは移譲しない", async () => {
    const t = setup();
    await t.run({ type: "transferOwner", userId: "u9" });
    expect(t.publish).not.toHaveBeenCalled();
    expect(t.voiceChannel.permissionOverwrites.edit).not.toHaveBeenCalled();
  });
});
