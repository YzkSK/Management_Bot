import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createDb } from "./client.js";
import { listenForLogChannelSettingChanges, type LogChannelSettingChangedNotification } from "./log-entry-notifications.js";
import { guilds, logChannelSettings } from "./schema/index.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required to run this test");

const { db, close } = createDb(databaseUrl);
const guildId = `test-guild-${randomUUID()}`;

let listener: { ready: Promise<void>; close: () => Promise<void> } | undefined;

afterAll(async () => {
  await db.delete(guilds).where(eq(guilds.id, guildId));
  await close();
});

beforeEach(async () => {
  await db.delete(guilds).where(eq(guilds.id, guildId));
  await db.insert(guilds).values({ id: guildId, name: "guild" });
});

afterEach(async () => {
  await listener?.close();
  listener = undefined;
});

function waitForNotification(
  timeoutMs = 5000,
): {
  notification: Promise<LogChannelSettingChangedNotification>;
  onChange: (n: LogChannelSettingChangedNotification) => void;
} {
  let resolve!: (n: LogChannelSettingChangedNotification) => void;
  let reject!: (e: Error) => void;
  const notification = new Promise<LogChannelSettingChangedNotification>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  const timer = setTimeout(() => reject(new Error("notification timed out")), timeoutMs);
  return {
    notification,
    onChange: (n) => {
      clearTimeout(timer);
      resolve(n);
    },
  };
}

describe("listenForLogChannelSettingChanges", () => {
  test("log_channel_settingsへのINSERTでguildId/categoryを通知する", async () => {
    const { notification, onChange } = waitForNotification();
    listener = listenForLogChannelSettingChanges(databaseUrl, onChange);
    await listener.ready;

    await db.insert(logChannelSettings).values({ guildId, category: "message", channelId: "c1" });

    const result = await notification;
    expect(result).toEqual({ guildId, category: "message" });
  });

  test("UPDATEでも通知する", async () => {
    await db.insert(logChannelSettings).values({ guildId, category: "message", channelId: "c1" });

    const { notification, onChange } = waitForNotification();
    listener = listenForLogChannelSettingChanges(databaseUrl, onChange);
    await listener.ready;

    await db
      .update(logChannelSettings)
      .set({ channelId: "c2" })
      .where(eq(logChannelSettings.guildId, guildId));

    const result = await notification;
    expect(result).toEqual({ guildId, category: "message" });
  });

  test("DELETEでも(削除前の)guildId/categoryを通知する", async () => {
    await db.insert(logChannelSettings).values({ guildId, category: "message", channelId: "c1" });

    const { notification, onChange } = waitForNotification();
    listener = listenForLogChannelSettingChanges(databaseUrl, onChange);
    await listener.ready;

    await db.delete(logChannelSettings).where(eq(logChannelSettings.guildId, guildId));

    const result = await notification;
    expect(result).toEqual({ guildId, category: "message" });
  });

  test("UPDATEで複合主キー(category)自体が変わる場合、新旧両方のキーを通知する", async () => {
    await db.insert(logChannelSettings).values({ guildId, category: "message", channelId: "c1" });

    const notifications: LogChannelSettingChangedNotification[] = [];
    let onChange: (n: LogChannelSettingChangedNotification) => void = () => {};
    const received = new Promise<void>((resolve) => {
      onChange = (n) => {
        notifications.push(n);
        if (notifications.length >= 2) resolve();
      };
    });
    listener = listenForLogChannelSettingChanges(databaseUrl, (n) => onChange(n));
    await listener.ready;

    await db
      .update(logChannelSettings)
      .set({ category: "reaction" })
      .where(eq(logChannelSettings.guildId, guildId));

    await Promise.race([
      received,
      new Promise((_resolve, reject) => setTimeout(() => reject(new Error("timed out")), 5000)),
    ]);

    expect(notifications).toContainEqual({ guildId, category: "message" });
    expect(notifications).toContainEqual({ guildId, category: "reaction" });
  });
});
