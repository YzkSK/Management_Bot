import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createDb } from "./client.js";
import {
  findModerationCaseIdForDeletedMessages,
  recordModerationMessageDeletionLinks,
} from "./moderation-message-deletion-links.js";
import { guilds, moderationMessageDeletionLinks } from "./schema/index.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required to run this test");

const { db, close } = createDb(databaseUrl);
const guildId = `test-guild-${randomUUID()}`;

afterAll(async () => {
  await db.delete(guilds).where(eq(guilds.id, guildId));
  await close();
});

beforeEach(async () => {
  await db.delete(guilds).where(eq(guilds.id, guildId));
  await db.insert(guilds).values({ id: guildId, name: "guild" });
});

describe("moderation message deletion links", () => {
  test("同じcaseIdで保存した削除対象メッセージ群からcaseIdを解決する", async () => {
    await recordModerationMessageDeletionLinks(db, {
      guildId,
      caseId: "case-1",
      messageIds: ["message-1", "message-2"],
    });

    const caseId = await findModerationCaseIdForDeletedMessages(db, guildId, ["message-1", "message-2"]);
    expect(caseId).toBe("case-1");
  });

  test("異なるcaseIdまたは未記録のメッセージを含む場合は関連付けない", async () => {
    await recordModerationMessageDeletionLinks(db, {
      guildId,
      caseId: "case-1",
      messageIds: ["message-1"],
    });
    await recordModerationMessageDeletionLinks(db, {
      guildId,
      caseId: "case-2",
      messageIds: ["message-2"],
    });

    expect(await findModerationCaseIdForDeletedMessages(db, guildId, ["message-1", "message-2"])).toBeNull();
    expect(await findModerationCaseIdForDeletedMessages(db, guildId, ["message-1", "message-3"])).toBeNull();
  });

  test("期限切れの関連付けは解決しない", async () => {
    await db.insert(moderationMessageDeletionLinks).values({
      guildId,
      messageId: "message-1",
      caseId: "case-1",
      expiresAt: new Date(Date.now() - 1),
    });

    expect(await findModerationCaseIdForDeletedMessages(db, guildId, ["message-1"])).toBeNull();
  });
});
