import { afterAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { createDb } from "@management-bot/db";
import { notifyTempVoiceAutoSetup, notifyTempVoiceChannelAction, notifyTempVoiceForceDelete } from "./notify-dashboard-actions.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required to run this test");

const { db, close } = createDb(databaseUrl);

afterAll(async () => {
  await close();
});

describe("notifyTempVoiceAutoSetup", () => {
  test("pg_notifyがエラーにならず完了する(#415)", async () => {
    await expect(notifyTempVoiceAutoSetup(db, `guild-${randomUUID()}`)).resolves.toBeUndefined();
  });
});

describe("notifyTempVoiceChannelAction", () => {
  test("pg_notifyがエラーにならず完了する(#649)", async () => {
    await expect(
      notifyTempVoiceChannelAction(db, {
        guildId: `guild-${randomUUID()}`,
        channelId: `channel-${randomUUID()}`,
        executorId: "user-1",
        action: { type: "setLocked", locked: true },
      }),
    ).resolves.toBeUndefined();
  });
});

describe("notifyTempVoiceForceDelete", () => {
  test("pg_notifyがエラーにならず完了する(#415)", async () => {
    await expect(notifyTempVoiceForceDelete(db, `guild-${randomUUID()}`, `channel-${randomUUID()}`)).resolves.toBeUndefined();
  });
});
