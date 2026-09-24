import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { createDb, guilds, tempVoiceChannels, tempVoiceConfigs } from "@management-bot/db";
import { eq } from "drizzle-orm";
import {
  clearGracePeriod,
  completeExpiredGracePeriod,
  deleteTempVoiceChannel,
  findExpiredGracePeriodChannels,
  findOwnedTempVoiceChannelId,
  findTempVoiceChannel,
  getTempVoiceConfig,
  insertTempVoiceChannel,
  startGracePeriod,
  transferTempVoiceOwner,
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

describe("findTempVoiceChannel", () => {
  test("存在しないchannelIdはnullを返す", async () => {
    expect(await findTempVoiceChannel(db, "no-such-channel")).toBeNull();
  });

  test("存在するchannelIdは行全体を返す(#408のオーナーチェック・controlChannelId解決用)", async () => {
    const channelId = `channel-${randomUUID()}`;
    await insertTempVoiceChannel(db, { channelId, guildId, controlChannelId: "control-1", ownerId: "user-1" });

    expect(await findTempVoiceChannel(db, channelId)).toEqual({
      channelId,
      guildId,
      controlChannelId: "control-1",
      ownerId: "user-1",
    });
  });
});

describe("transferTempVoiceOwner", () => {
  test("expectedOwnerIdが一致すればownerIdを更新し、猶予情報もクリアする(#410)", async () => {
    const channelId = `channel-${randomUUID()}`;
    await insertTempVoiceChannel(db, { channelId, guildId, controlChannelId: "control-1", ownerId: "user-1" });
    await startGracePeriod(db, channelId, "user-1", new Date());

    const result = await transferTempVoiceOwner(db, channelId, "user-1", "user-2");

    expect(result).toBe("committed");
    const [row] = await db.select().from(tempVoiceChannels).where(eq(tempVoiceChannels.channelId, channelId));
    expect(row).toMatchObject({ ownerId: "user-2", gracePeriodOwnerId: null, gracePeriodEndsAt: null });
  });

  test("expectedOwnerIdが一致しなければ何もせず\"lostRace\"を返す(codexレビュー指摘: 手動移譲とcronの競合防止)", async () => {
    const channelId = `channel-${randomUUID()}`;
    await insertTempVoiceChannel(db, { channelId, guildId, controlChannelId: "control-1", ownerId: "user-1" });

    const result = await transferTempVoiceOwner(db, channelId, "wrong-owner", "user-2");

    expect(result).toBe("lostRace");
    const [row] = await db.select().from(tempVoiceChannels).where(eq(tempVoiceChannels.channelId, channelId));
    expect(row?.ownerId).toBe("user-1");
  });

  test("移譲先が既に別の一時VCのオーナーなら\"newOwnerAlreadyOwnsChannel\"を返し何も変更しない(codexレビュー指摘: unique制約違反の未ハンドリング)", async () => {
    const channelId = `channel-${randomUUID()}`;
    const otherChannelId = `channel-${randomUUID()}`;
    await insertTempVoiceChannel(db, { channelId, guildId, controlChannelId: "control-1", ownerId: "user-1" });
    await insertTempVoiceChannel(db, { channelId: otherChannelId, guildId, controlChannelId: "control-2", ownerId: "user-2" });

    const result = await transferTempVoiceOwner(db, channelId, "user-1", "user-2");

    expect(result).toBe("newOwnerAlreadyOwnsChannel");
    const [row] = await db.select().from(tempVoiceChannels).where(eq(tempVoiceChannels.channelId, channelId));
    expect(row?.ownerId).toBe("user-1");
  });
});

describe("completeExpiredGracePeriod", () => {
  test("expectedGracePeriodOwnerId/expectedGracePeriodEndsAtが一致すればownerIdを更新し猶予情報をクリアする(#410)", async () => {
    const channelId = `channel-${randomUUID()}`;
    const endsAt = new Date(Date.now() - 60_000);
    await insertTempVoiceChannel(db, { channelId, guildId, controlChannelId: "control-1", ownerId: "user-1" });
    await startGracePeriod(db, channelId, "user-1", endsAt);

    const result = await completeExpiredGracePeriod(db, channelId, "user-1", endsAt, "user-2");

    expect(result).toBe("committed");
    const [row] = await db.select().from(tempVoiceChannels).where(eq(tempVoiceChannels.channelId, channelId));
    expect(row).toMatchObject({ ownerId: "user-2", gracePeriodOwnerId: null, gracePeriodEndsAt: null });
  });

  test("既に手動移譲等で猶予がクリアされていれば何もせず\"lostRace\"を返す(codexレビュー指摘: cronと手動移譲の競合防止)", async () => {
    const channelId = `channel-${randomUUID()}`;
    await insertTempVoiceChannel(db, { channelId, guildId, controlChannelId: "control-1", ownerId: "user-2" });
    // 猶予は設定されていない(手動移譲で既にクリア済みの状態を再現)。

    const result = await completeExpiredGracePeriod(db, channelId, "user-1", new Date(), "user-3");

    expect(result).toBe("lostRace");
    const [row] = await db.select().from(tempVoiceChannels).where(eq(tempVoiceChannels.channelId, channelId));
    expect(row?.ownerId).toBe("user-2");
  });

  test("同一ユーザーが再入室→再退出して新しい猶予期限になっていれば、古い期限値では何もせず\"lostRace\"を返す(codexレビュー指摘: 猶予期限値そのものを比較しないと新しい猶予を誤って確定してしまう)", async () => {
    const channelId = `channel-${randomUUID()}`;
    const staleEndsAt = new Date(Date.now() - 120_000);
    const freshEndsAt = new Date(Date.now() - 60_000);
    await insertTempVoiceChannel(db, { channelId, guildId, controlChannelId: "control-1", ownerId: "user-1" });
    await startGracePeriod(db, channelId, "user-1", staleEndsAt);
    // 再入室→再退出で同一ユーザーの新しい猶予が始まった状態を再現する(gracePeriodOwnerIdは同じuser-1のまま)。
    await startGracePeriod(db, channelId, "user-1", freshEndsAt);

    const result = await completeExpiredGracePeriod(db, channelId, "user-1", staleEndsAt, "user-2");

    expect(result).toBe("lostRace");
    const [row] = await db.select().from(tempVoiceChannels).where(eq(tempVoiceChannels.channelId, channelId));
    expect(row?.ownerId).toBe("user-1");
    expect(row?.gracePeriodEndsAt?.toISOString()).toBe(freshEndsAt.toISOString());
  });

  test("移譲先が既に別の一時VCのオーナーなら\"newOwnerAlreadyOwnsChannel\"を返し何も変更しない", async () => {
    const channelId = `channel-${randomUUID()}`;
    const otherChannelId = `channel-${randomUUID()}`;
    const endsAt = new Date(Date.now() - 60_000);
    await insertTempVoiceChannel(db, { channelId, guildId, controlChannelId: "control-1", ownerId: "user-1" });
    await insertTempVoiceChannel(db, { channelId: otherChannelId, guildId, controlChannelId: "control-2", ownerId: "user-2" });
    await startGracePeriod(db, channelId, "user-1", endsAt);

    const result = await completeExpiredGracePeriod(db, channelId, "user-1", endsAt, "user-2");

    expect(result).toBe("newOwnerAlreadyOwnsChannel");
    const [row] = await db.select().from(tempVoiceChannels).where(eq(tempVoiceChannels.channelId, channelId));
    expect(row?.ownerId).toBe("user-1");
  });
});

describe("startGracePeriod / clearGracePeriod / findExpiredGracePeriodChannels", () => {
  test("startGracePeriodで猶予情報が設定される", async () => {
    const channelId = `channel-${randomUUID()}`;
    await insertTempVoiceChannel(db, { channelId, guildId, controlChannelId: "control-1", ownerId: "user-1" });
    const endsAt = new Date("2026-01-01T00:00:00.000Z");

    await startGracePeriod(db, channelId, "user-1", endsAt);

    const [row] = await db.select().from(tempVoiceChannels).where(eq(tempVoiceChannels.channelId, channelId));
    expect(row?.gracePeriodOwnerId).toBe("user-1");
    expect(row?.gracePeriodEndsAt?.toISOString()).toBe(endsAt.toISOString());
  });

  test("expectedOwnerIdが実際のownerIdと異なれば猶予を開始しない(codexレビュー指摘: 退出検知直前の手動移譲との競合防止)", async () => {
    const channelId = `channel-${randomUUID()}`;
    await insertTempVoiceChannel(db, { channelId, guildId, controlChannelId: "control-1", ownerId: "user-2" });

    await startGracePeriod(db, channelId, "user-1", new Date());

    const [row] = await db.select().from(tempVoiceChannels).where(eq(tempVoiceChannels.channelId, channelId));
    expect(row?.gracePeriodOwnerId).toBeNull();
  });

  test("clearGracePeriodで猶予情報がクリアされる", async () => {
    const channelId = `channel-${randomUUID()}`;
    await insertTempVoiceChannel(db, { channelId, guildId, controlChannelId: "control-1", ownerId: "user-1" });
    await startGracePeriod(db, channelId, "user-1", new Date());

    await clearGracePeriod(db, channelId, "user-1");

    const [row] = await db.select().from(tempVoiceChannels).where(eq(tempVoiceChannels.channelId, channelId));
    expect(row).toMatchObject({ gracePeriodOwnerId: null, gracePeriodEndsAt: null });
  });

  test("expectedOwnerIdが実際のgracePeriodOwnerIdと異なれば何もしない(codexレビュー指摘: 再入室と自動再割当の競合防止)", async () => {
    const channelId = `channel-${randomUUID()}`;
    await insertTempVoiceChannel(db, { channelId, guildId, controlChannelId: "control-1", ownerId: "user-1" });
    await startGracePeriod(db, channelId, "user-1", new Date());

    await clearGracePeriod(db, channelId, "different-user");

    const [row] = await db.select().from(tempVoiceChannels).where(eq(tempVoiceChannels.channelId, channelId));
    expect(row?.gracePeriodOwnerId).toBe("user-1");
  });

  test("findExpiredGracePeriodChannelsは期限切れの猶予中チャンネルのみ返す", async () => {
    const expiredChannelId = `channel-${randomUUID()}`;
    const futureChannelId = `channel-${randomUUID()}`;
    const noGraceChannelId = `channel-${randomUUID()}`;
    const expiredEndsAt = new Date(Date.now() - 60_000);
    await insertTempVoiceChannel(db, { channelId: expiredChannelId, guildId, controlChannelId: "control-1", ownerId: "user-1" });
    await insertTempVoiceChannel(db, { channelId: futureChannelId, guildId, controlChannelId: "control-2", ownerId: "user-2" });
    await insertTempVoiceChannel(db, { channelId: noGraceChannelId, guildId, controlChannelId: "control-3", ownerId: "user-3" });
    await startGracePeriod(db, expiredChannelId, "user-1", expiredEndsAt);
    await startGracePeriod(db, futureChannelId, "user-2", new Date(Date.now() + 60_000));

    const expired = await findExpiredGracePeriodChannels(db, new Date());

    expect(expired.map((row) => row.channelId)).toEqual([expiredChannelId]);
    expect(expired[0]).toMatchObject({ channelId: expiredChannelId, guildId, controlChannelId: "control-1", gracePeriodOwnerId: "user-1" });
    expect(expired[0]?.gracePeriodEndsAt.toISOString()).toBe(expiredEndsAt.toISOString());
  });
});
