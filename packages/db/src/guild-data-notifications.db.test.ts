import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import type { GuildDataTopic } from "@management-bot/shared";
import { eq } from "drizzle-orm";
import { createDb } from "./client.js";
import { listenForGuildDataChanges, type GuildDataChangedNotification } from "./guild-data-notifications.js";
import {
  auditLogs,
  capabilityGrants,
  guilds,
  logChannelSettings,
  logRetentionSettings,
  moderationEscalationSettings,
  moderationLockdownSettings,
  moderationNgwords,
  moderationThresholds,
  moderationWhitelist,
  scheduledPostSettings,
  scheduledPosts,
  tempVoiceConfigs,
  tempVoiceDenyProtectedRoles,
} from "./schema/index.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required to run this test");

const { db, close } = createDb(databaseUrl);
const guildId = `test-guild-${randomUUID()}`;
const otherGuildId = `test-guild-${randomUUID()}`;

let listener: { ready: Promise<void>; close: () => Promise<void> } | undefined;
let received: GuildDataChangedNotification[] = [];

// audit_logsは追記専用(保持期間内の行はDELETE不可)のため掃除しない。guildIdは実行ごとに一意。
async function cleanup(): Promise<void> {
  await db.delete(guilds).where(eq(guilds.id, guildId));
  await db.delete(guilds).where(eq(guilds.id, otherGuildId));
}

beforeEach(async () => {
  await cleanup();
  await db.insert(guilds).values([
    { id: guildId, name: "guild" },
    { id: otherGuildId, name: "other" },
  ]);
  received = [];
  listener = listenForGuildDataChanges(databaseUrl, (n) => received.push(n));
  await listener.ready;
});

afterEach(async () => {
  await listener?.close();
  listener = undefined;
});

afterAll(async () => {
  await cleanup();
  await close();
});

async function waitFor(topic: GuildDataTopic, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!received.some((n) => n.guildId === guildId && n.topic === topic)) {
    if (Date.now() > deadline) throw new Error(`notification ${topic} timed out: ${JSON.stringify(received)}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

const inserts: ReadonlyArray<{ name: string; topic: GuildDataTopic; insert: () => Promise<unknown> }> = [
  {
    name: "audit_logs",
    topic: "auditLog",
    insert: () =>
      db.insert(auditLogs).values({
        id: randomUUID(),
        guildId,
        kind: "action",
        actorName: "a",
        feature: "f",
        action: "x",
        outcome: "success",
      }),
  },
  {
    name: "scheduled_posts",
    topic: "scheduledPost",
    insert: () =>
      db.insert(scheduledPosts).values({
        guildId,
        channelId: "c1",
        authorId: "u1",
        content: "hi",
        scheduledAt: new Date(Date.now() + 60_000),
      }),
  },
  { name: "scheduled_post_settings", topic: "scheduledPost", insert: () => db.insert(scheduledPostSettings).values({ guildId }) },
  { name: "temp_voice_configs", topic: "tempVoice", insert: () => db.insert(tempVoiceConfigs).values({ guildId }) },
  {
    name: "temp_voice_deny_protected_roles",
    topic: "tempVoice",
    insert: () => db.insert(tempVoiceDenyProtectedRoles).values({ guildId, roleId: "r1" }),
  },
  {
    name: "moderation_thresholds",
    topic: "moderation",
    insert: () => db.insert(moderationThresholds).values({ guildId, violationType: "flood", preset: "medium" }),
  },
  {
    name: "moderation_whitelist",
    topic: "moderation",
    insert: () => db.insert(moderationWhitelist).values({ guildId, targetType: "user", targetId: "u1" }),
  },
  {
    name: "moderation_ngwords",
    topic: "moderation",
    insert: () => db.insert(moderationNgwords).values({ id: randomUUID(), guildId, matchType: "exact", pattern: "bad" }),
  },
  { name: "moderation_escalation_settings", topic: "moderation", insert: () => db.insert(moderationEscalationSettings).values({ guildId }) },
  { name: "moderation_lockdown_settings", topic: "moderation", insert: () => db.insert(moderationLockdownSettings).values({ guildId }) },
  {
    name: "log_retention_settings",
    topic: "loggingSettings",
    insert: () => db.insert(logRetentionSettings).values({ guildId, category: "message", retentionDays: 30 }),
  },
  {
    name: "log_channel_settings",
    topic: "loggingSettings",
    insert: () => db.insert(logChannelSettings).values({ guildId, category: "message", channelId: "c1" }),
  },
  {
    name: "capability_grants",
    topic: "access",
    insert: () => db.insert(capabilityGrants).values({ id: randomUUID(), guildId, targetType: "user", targetId: "u1", capabilities: 1 }),
  },
];

describe("guild_data_changed トリガー", () => {
  for (const { name, topic, insert } of inserts) {
    test(`${name}へのINSERTでguildIdと${topic}を通知する`, async () => {
      await insert();
      await waitFor(topic);
      expect(received.every((n) => n.guildId === guildId)).toBe(true);
    });
  }

  test("UPDATEでも通知する", async () => {
    await db.insert(tempVoiceConfigs).values({ guildId });
    await waitFor("tempVoice");
    received = [];

    await db.update(tempVoiceConfigs).set({ nameTemplate: "x" }).where(eq(tempVoiceConfigs.guildId, guildId));

    await waitFor("tempVoice");
  });

  test("DELETEでは削除前の行のguildIdを通知する", async () => {
    await db.insert(capabilityGrants).values({ id: "g1", guildId, targetType: "user", targetId: "u1", capabilities: 1 });
    await waitFor("access");
    received = [];

    await db.delete(capabilityGrants).where(eq(capabilityGrants.guildId, guildId));

    await waitFor("access");
  });

  test("他guildの変更はそのguildIdで通知される", async () => {
    await db.insert(tempVoiceConfigs).values({ guildId: otherGuildId });
    const deadline = Date.now() + 5000;
    while (!received.some((n) => n.guildId === otherGuildId)) {
      if (Date.now() > deadline) throw new Error("timed out");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(received.some((n) => n.guildId === guildId)).toBe(false);
    expect(received).toContainEqual({ guildId: otherGuildId, topic: "tempVoice" });
  });
});
