import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { createDb, type Db, guilds } from "@management-bot/db";
import { eq } from "drizzle-orm";
import {
  clearLockdownChannelSnapshots,
  getLockdownSettings,
  listLockdownChannelSnapshots,
  markLockdownApplied,
  saveLockdownChannelSnapshots,
  setAutoLockdownOnRaid,
  setLockdownRequested,
} from "./lockdown-settings.js";

describe("lockdown-settings", () => {
  let db: Db;
  let close: () => Promise<void>;
  const guildId = `test-guild-${randomUUID()}`;

  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error("DATABASE_URL is required");
    ({ db, close } = createDb(databaseUrl));
    await db.insert(guilds).values({ id: guildId, name: "Test Guild" });
  });

  afterAll(async () => {
    await db.delete(guilds).where(eq(guilds.id, guildId));
    await close();
  });

  test("未設定のguildは自動・手動ロックとも無効で、未適用を返す", async () => {
    expect(await getLockdownSettings(db, guildId)).toEqual({
      autoLockdownOnRaid: false,
      requestedLocked: false,
      isLocked: false,
    });
  });

  test("自動ロックダウンと手動ロック要求をそれぞれ保存できる", async () => {
    await setAutoLockdownOnRaid(db, guildId, true);
    await setLockdownRequested(db, guildId, true);

    expect(await getLockdownSettings(db, guildId)).toEqual({
      autoLockdownOnRaid: true,
      requestedLocked: true,
      isLocked: false,
    });
  });

  test("Discord権限の適用済み状態を保存でき、解除要求時も自動設定は維持する", async () => {
    await markLockdownApplied(db, guildId, true);
    await setLockdownRequested(db, guildId, false);

    expect(await getLockdownSettings(db, guildId)).toEqual({
      autoLockdownOnRaid: true,
      requestedLocked: false,
      isLocked: true,
    });
  });

  test("チャンネル権限スナップショットは初回の値を保持し、解除後に削除できる", async () => {
    await saveLockdownChannelSnapshots(db, guildId, [
      { channelId: "channel-allow", sendMessages: true },
      { channelId: "channel-deny", sendMessages: false },
      { channelId: "channel-inherit", sendMessages: null },
    ]);
    await saveLockdownChannelSnapshots(db, guildId, [{ channelId: "channel-allow", sendMessages: false }]);

    expect(await listLockdownChannelSnapshots(db, guildId)).toEqual([
      { channelId: "channel-allow", sendMessages: true },
      { channelId: "channel-deny", sendMessages: false },
      { channelId: "channel-inherit", sendMessages: null },
    ]);

    await clearLockdownChannelSnapshots(db, guildId);
    expect(await listLockdownChannelSnapshots(db, guildId)).toEqual([]);
  });
});
