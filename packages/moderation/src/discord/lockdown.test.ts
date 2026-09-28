import { afterAll, afterEach, beforeAll, describe, expect, mock, spyOn, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { createDb, type Db, guilds } from "@management-bot/db";
import { PermissionFlagsBits, PermissionsBitField, type Guild } from "discord.js";
import { eq } from "drizzle-orm";
import { getLockdownSettings, setLockdownRequested } from "../application/index.js";
import { synchronizeLockdown } from "./lockdown.js";

function fakeGuild(guildId: string) {
  const makeChannel = (channelId: string, sendMessages: boolean | null) => {
    const allow = new PermissionsBitField(sendMessages === true ? PermissionFlagsBits.SendMessages : 0n);
    const deny = new PermissionsBitField(sendMessages === false ? PermissionFlagsBits.SendMessages : 0n);
    return {
      id: channelId,
      isTextBased: () => true,
      isThread: () => false,
      permissionOverwrites: {
        cache: new Map([[guildId, { allow, deny }]]),
        edit: mock(() => Promise.resolve()),
      },
    };
  };
  const allow = makeChannel("channel-allow", true);
  const deny = makeChannel("channel-deny", false);
  const inherit = makeChannel("channel-inherit", null);
  return {
    guild: { id: guildId, channels: { cache: new Map([[allow.id, allow], [deny.id, deny], [inherit.id, inherit]]) } },
    channels: { allow, deny, inherit },
  };
}

describe("synchronizeLockdown", () => {
  let db: Db;
  let close: () => Promise<void>;
  const guildId = `test-guild-${randomUUID()}`;

  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error("DATABASE_URL is required");
    ({ db, close } = createDb(databaseUrl));
    await db.insert(guilds).values({ id: guildId, name: "Test Guild" });
  });

  afterEach(async () => {
    await db.delete(guilds).where(eq(guilds.id, guildId));
    await db.insert(guilds).values({ id: guildId, name: "Test Guild" });
  });

  afterAll(async () => {
    await db.delete(guilds).where(eq(guilds.id, guildId));
    await close();
  });

  test("手動開始は@everyoneの送信権限を止め、解除時に各チャンネルの元の値を復元する", async () => {
    const { guild, channels } = fakeGuild(guildId);
    await setLockdownRequested(db, guildId, true);

    await synchronizeLockdown(db, guild as unknown as Guild);

    expect(channels.allow.permissionOverwrites.edit).toHaveBeenCalledWith(guildId, { SendMessages: false });
    expect(channels.deny.permissionOverwrites.edit).toHaveBeenCalledWith(guildId, { SendMessages: false });
    expect(channels.inherit.permissionOverwrites.edit).toHaveBeenCalledWith(guildId, { SendMessages: false });
    expect((await getLockdownSettings(db, guildId)).isLocked).toBe(true);

    await setLockdownRequested(db, guildId, false);
    await synchronizeLockdown(db, guild as unknown as Guild);

    expect(channels.allow.permissionOverwrites.edit).toHaveBeenLastCalledWith(guildId, { SendMessages: true });
    expect(channels.deny.permissionOverwrites.edit).toHaveBeenLastCalledWith(guildId, { SendMessages: false });
    expect(channels.inherit.permissionOverwrites.edit).toHaveBeenLastCalledWith(guildId, { SendMessages: null });
    expect((await getLockdownSettings(db, guildId)).isLocked).toBe(false);
  });

  test("1チャンネルの権限変更が失敗しても他チャンネルの処理を継続し、失敗をログに記録する", async () => {
    const { guild, channels } = fakeGuild(guildId);
    const permissionError = new Error("Missing Permissions");
    channels.allow.permissionOverwrites.edit.mockImplementation(() => Promise.reject(permissionError));
    const consoleError = spyOn(console, "error").mockImplementation(() => {});

    try {
      await setLockdownRequested(db, guildId, true);
      expect(await synchronizeLockdown(db, guild as unknown as Guild)).toBe("locked");

      expect(channels.deny.permissionOverwrites.edit).toHaveBeenCalledWith(guildId, { SendMessages: false });
      expect(channels.inherit.permissionOverwrites.edit).toHaveBeenCalledWith(guildId, { SendMessages: false });
      expect((await getLockdownSettings(db, guildId)).isLocked).toBe(true);

      await setLockdownRequested(db, guildId, false);
      expect(await synchronizeLockdown(db, guild as unknown as Guild)).toBe("released");

      expect(channels.deny.permissionOverwrites.edit).toHaveBeenLastCalledWith(guildId, { SendMessages: false });
      expect(channels.inherit.permissionOverwrites.edit).toHaveBeenLastCalledWith(guildId, { SendMessages: null });
      expect((await getLockdownSettings(db, guildId)).isLocked).toBe(false);

      const logged = consoleError.mock.calls.filter((call) => call[1] === permissionError).map((call) => call[0]);
      expect(logged).toEqual([
        `moderation: failed to lock lockdown for channel channel-allow in guild ${guildId}`,
        `moderation: failed to release lockdown for channel channel-allow in guild ${guildId}`,
      ]);
    } finally {
      consoleError.mockRestore();
    }
  });

  test("同じguildへの同時呼び出しは直列化され、権限変更を重複実行しない(レイド中の連続参加)", async () => {
    const { guild, channels } = fakeGuild(guildId);
    await setLockdownRequested(db, guildId, true);

    const results = await Promise.all([
      synchronizeLockdown(db, guild as unknown as Guild),
      synchronizeLockdown(db, guild as unknown as Guild),
      synchronizeLockdown(db, guild as unknown as Guild),
    ]);

    expect(results).toEqual(["locked", "unchanged", "unchanged"]);
    expect(channels.allow.permissionOverwrites.edit).toHaveBeenCalledTimes(1);
    expect(channels.deny.permissionOverwrites.edit).toHaveBeenCalledTimes(1);
    expect(channels.inherit.permissionOverwrites.edit).toHaveBeenCalledTimes(1);
  });

  test("先行の同期が失敗しても、後続の呼び出しは実行される", async () => {
    const { guild, channels } = fakeGuild(guildId);
    await setLockdownRequested(db, guildId, true);
    const brokenGuild = {
      id: guildId,
      get channels(): never {
        throw new Error("cache unavailable");
      },
    };

    const [first, second] = await Promise.allSettled([
      synchronizeLockdown(db, brokenGuild as unknown as Guild),
      synchronizeLockdown(db, guild as unknown as Guild),
    ]);

    expect(first.status).toBe("rejected");
    expect(second).toEqual({ status: "fulfilled", value: "locked" });
    expect(channels.allow.permissionOverwrites.edit).toHaveBeenCalledWith(guildId, { SendMessages: false });
  });

  test("チャンネル数が多い場合は10件ごとに待機を挟んで権限変更する(レート制限対策)", async () => {
    const edits: string[] = [];
    const sleep = mock((ms: number) => {
      edits.push(`sleep:${ms}`);
      return Promise.resolve();
    });
    const cache = new Map(
      Array.from({ length: 25 }, (_, i) => {
        const id = `channel-${String(i).padStart(2, "0")}`;
        const channel = {
          id,
          isTextBased: () => true,
          isThread: () => false,
          permissionOverwrites: {
            cache: new Map(),
            edit: mock(() => {
              edits.push(id);
              return Promise.resolve();
            }),
          },
        };
        return [id, channel] as const;
      }),
    );
    await setLockdownRequested(db, guildId, true);

    await synchronizeLockdown(db, { id: guildId, channels: { cache } } as unknown as Guild, { sleep });

    expect(sleep).toHaveBeenCalledTimes(2);
    expect(edits.indexOf("sleep:1000")).toBe(10);
    expect(edits.lastIndexOf("sleep:1000")).toBe(21);
    expect(edits.filter((e) => e.startsWith("channel-"))).toHaveLength(25);
  });
});
