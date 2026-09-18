import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createDb } from "./client.js";
import {
  listenForModerationConfigChanges,
  type ModerationConfigChangedNotification,
} from "./moderation-config-notifications.js";
import { guilds, moderationNgwords, moderationThresholds, moderationWhitelist } from "./schema/index.js";

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
  notification: Promise<ModerationConfigChangedNotification>;
  onChange: (n: ModerationConfigChangedNotification) => void;
} {
  let resolve!: (n: ModerationConfigChangedNotification) => void;
  let reject!: (e: Error) => void;
  const notification = new Promise<ModerationConfigChangedNotification>((res, rej) => {
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

describe("listenForModerationConfigChanges", () => {
  test("moderation_thresholdsへのINSERTでguildIdを通知する", async () => {
    const { notification, onChange } = waitForNotification();
    listener = listenForModerationConfigChanges(databaseUrl, onChange);
    await listener.ready;

    await db.insert(moderationThresholds).values({ guildId, violationType: "flood", preset: "strong", enabled: true });

    const result = await notification;
    expect(result).toEqual({ guildId });
  });

  test("moderation_whitelistへのDELETEでもguildIdを通知する", async () => {
    await db.insert(moderationWhitelist).values({ guildId, targetType: "user", targetId: "u1" });

    const { notification, onChange } = waitForNotification();
    listener = listenForModerationConfigChanges(databaseUrl, onChange);
    await listener.ready;

    await db.delete(moderationWhitelist).where(eq(moderationWhitelist.guildId, guildId));

    const result = await notification;
    expect(result).toEqual({ guildId });
  });

  test("moderation_ngwordsへのUPDATEでもguildIdを通知する", async () => {
    const id = randomUUID();
    await db.insert(moderationNgwords).values({ id, guildId, matchType: "exact", pattern: "foo" });

    const { notification, onChange } = waitForNotification();
    listener = listenForModerationConfigChanges(databaseUrl, onChange);
    await listener.ready;

    await db.update(moderationNgwords).set({ pattern: "bar" }).where(eq(moderationNgwords.id, id));

    const result = await notification;
    expect(result).toEqual({ guildId });
  });
});
