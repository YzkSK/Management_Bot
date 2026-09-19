import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
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
});
