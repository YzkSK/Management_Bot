import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { createDb, guilds, tempVoiceChannels, tempVoiceConfigs } from "@management-bot/db";
import { eq } from "drizzle-orm";
import {
  deleteTempVoiceChannel,
  findOwnedTempVoiceChannelId,
  getTempVoiceConfig,
  insertTempVoiceChannel,
} from "./create-temp-voice-channel.js";

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

describe("getTempVoiceConfig", () => {
  test("未設定のギルドはnullを返す", async () => {
    expect(await getTempVoiceConfig(db, guildId)).toBeNull();
  });

  test("設定済みのギルドは設定内容を返す", async () => {
    await db.insert(tempVoiceConfigs).values({
      guildId,
      createChannelId: "create-ch",
      categoryId: "category-1",
      nameTemplate: "{username}のVC",
      defaultUserLimit: 5,
      defaultBitrate: 96000,
    });

    const config = await getTempVoiceConfig(db, guildId);

    expect(config).toMatchObject({
      guildId,
      createChannelId: "create-ch",
      categoryId: "category-1",
      nameTemplate: "{username}のVC",
      defaultUserLimit: 5,
      defaultBitrate: 96000,
    });
  });
});

describe("findOwnedTempVoiceChannelId", () => {
  test("オーナーとして持つVCが無ければnullを返す", async () => {
    expect(await findOwnedTempVoiceChannelId(db, guildId, "user-1")).toBeNull();
  });

  test("オーナーとして持つVCがあればそのchannelIdを返す", async () => {
    const channelId = `channel-${randomUUID()}`;
    await db.insert(tempVoiceChannels).values({
      channelId,
      guildId,
      controlChannelId: "control-1",
      ownerId: "user-1",
    });

    expect(await findOwnedTempVoiceChannelId(db, guildId, "user-1")).toBe(channelId);
  });

  test("別ギルドの同一ownerIdは対象外", async () => {
    const otherGuildId = `test-guild-${randomUUID()}`;
    await db.insert(guilds).values({ id: otherGuildId, name: "other" });
    await db.insert(tempVoiceChannels).values({
      channelId: `channel-${randomUUID()}`,
      guildId: otherGuildId,
      controlChannelId: "control-1",
      ownerId: "user-1",
    });

    expect(await findOwnedTempVoiceChannelId(db, guildId, "user-1")).toBeNull();

    await db.delete(guilds).where(eq(guilds.id, otherGuildId));
  });
});

describe("insertTempVoiceChannel / deleteTempVoiceChannel", () => {
  test("insertした行が取得でき、deleteすると消える", async () => {
    const channelId = `channel-${randomUUID()}`;
    await insertTempVoiceChannel(db, { channelId, guildId, controlChannelId: "control-1", ownerId: "user-1" });

    expect(await findOwnedTempVoiceChannelId(db, guildId, "user-1")).toBe(channelId);

    await deleteTempVoiceChannel(db, channelId);

    expect(await findOwnedTempVoiceChannelId(db, guildId, "user-1")).toBeNull();
  });

  test("同一guildId+ownerIdの2重insertはunique制約違反になる(#406)", async () => {
    await insertTempVoiceChannel(db, {
      channelId: `channel-${randomUUID()}`,
      guildId,
      controlChannelId: "control-1",
      ownerId: "user-1",
    });

    let threw = false;
    try {
      await insertTempVoiceChannel(db, {
        channelId: `channel-${randomUUID()}`,
        guildId,
        controlChannelId: "control-2",
        ownerId: "user-1",
      });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });
});
