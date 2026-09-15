import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { createDb, type Db, guilds, moderationEscalationState } from "@management-bot/db";
import { and, eq } from "drizzle-orm";
import {
  decayStrikes,
  getTotalStrikeCount,
  incrementStrike,
  listStrikes,
  resetAllStrikes,
  resetStrike,
} from "./escalation-state.js";

describe("incrementStrike", () => {
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

  test("初回は1、以後は呼ぶたびにインクリメントされる", async () => {
    const userId = `u-${randomUUID()}`;
    expect(await incrementStrike(db, guildId, userId, "flood")).toBe(1);
    expect(await incrementStrike(db, guildId, userId, "flood")).toBe(2);
    expect(await incrementStrike(db, guildId, userId, "flood")).toBe(3);
  });

  test("violationTypeが異なれば独立してカウントされる", async () => {
    const userId = `u-${randomUUID()}`;
    expect(await incrementStrike(db, guildId, userId, "flood")).toBe(1);
    expect(await incrementStrike(db, guildId, userId, "duplicate_content")).toBe(1);
  });

  test("インクリメントのたびにlastViolationAtが更新される", async () => {
    const userId = `u-${randomUUID()}`;
    await incrementStrike(db, guildId, userId, "flood");
    const [first] = await db
      .select({ lastViolationAt: moderationEscalationState.lastViolationAt })
      .from(moderationEscalationState)
      .where(
        and(
          eq(moderationEscalationState.guildId, guildId),
          eq(moderationEscalationState.userId, userId),
          eq(moderationEscalationState.violationType, "flood"),
        ),
      );

    await new Promise((r) => setTimeout(r, 10));
    await incrementStrike(db, guildId, userId, "flood");
    const [second] = await db
      .select({ lastViolationAt: moderationEscalationState.lastViolationAt })
      .from(moderationEscalationState)
      .where(
        and(
          eq(moderationEscalationState.guildId, guildId),
          eq(moderationEscalationState.userId, userId),
          eq(moderationEscalationState.violationType, "flood"),
        ),
      );

    expect(second?.lastViolationAt.getTime()).toBeGreaterThan(first?.lastViolationAt.getTime() ?? 0);
  });
});

describe("resetStrike", () => {
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

  test("該当行を削除する", async () => {
    const userId = `u-${randomUUID()}`;
    await incrementStrike(db, guildId, userId, "flood");

    await resetStrike(db, guildId, userId, "flood");

    const rows = await db
      .select()
      .from(moderationEscalationState)
      .where(
        and(
          eq(moderationEscalationState.guildId, guildId),
          eq(moderationEscalationState.userId, userId),
          eq(moderationEscalationState.violationType, "flood"),
        ),
      );
    expect(rows).toHaveLength(0);
  });

  test("該当行が存在しなくてもエラーにならない", async () => {
    const userId = `u-${randomUUID()}`;
    await expect(resetStrike(db, guildId, userId, "flood")).resolves.toBeUndefined();
  });
});

describe("decayStrikes", () => {
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

  async function seed(userId: string, strikeCount: number, hoursAgo: number) {
    await db.insert(moderationEscalationState).values({
      guildId,
      userId,
      violationType: "flood",
      strikeCount,
      lastViolationAt: new Date(Date.now() - hoursAgo * 60 * 60 * 1000),
    });
  }

  async function getRow(userId: string) {
    const [row] = await db
      .select()
      .from(moderationEscalationState)
      .where(
        and(
          eq(moderationEscalationState.guildId, guildId),
          eq(moderationEscalationState.userId, userId),
          eq(moderationEscalationState.violationType, "flood"),
        ),
      );
    return row;
  }

  test("baseHours×strikeCountを経過した行はstrikeCountが1減りlastViolationAtが更新される", async () => {
    const userId = `u-${randomUUID()}`;
    await seed(userId, 2, 49); // baseHours=24 → 閾値48hを経過

    await decayStrikes(db, 24);

    const row = await getRow(userId);
    expect(row?.strikeCount).toBe(1);
    expect(row?.lastViolationAt.getTime()).toBeGreaterThan(Date.now() - 60 * 1000);
  });

  test("閾値未満の行は変化しない", async () => {
    const userId = `u-${randomUUID()}`;
    await seed(userId, 2, 47); // 閾値48hに未達

    await decayStrikes(db, 24);

    const row = await getRow(userId);
    expect(row?.strikeCount).toBe(2);
  });

  test("ちょうど閾値時刻に達した行も減少する(境界値、>=判定)", async () => {
    const userId = `u-${randomUUID()}`;
    await seed(userId, 1, 24); // 閾値24hにちょうど到達

    await decayStrikes(db, 24);

    expect(await getRow(userId)).toBeUndefined(); // 0になり行削除
  });

  test("strikeCountが多いほど減少までの時間が長い(strikeCount=1は24hで減るがstrikeCount=2は24hでは減らない)", async () => {
    const singleUserId = `u-${randomUUID()}`;
    const doubleUserId = `u-${randomUUID()}`;
    await seed(singleUserId, 1, 25); // 閾値24hを経過
    await seed(doubleUserId, 2, 25); // 閾値48hに未達

    await decayStrikes(db, 24);

    expect((await getRow(singleUserId))?.strikeCount).toBeUndefined(); // 0になり行削除
    expect((await getRow(doubleUserId))?.strikeCount).toBe(2);
  });

  test("strikeCountが1から0になる行は削除される", async () => {
    const userId = `u-${randomUUID()}`;
    await seed(userId, 1, 25);

    await decayStrikes(db, 24);

    expect(await getRow(userId)).toBeUndefined();
  });
});

describe("listStrikes", () => {
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

  test("guild内の全ストライク行を返す", async () => {
    const userId = `u-${randomUUID()}`;
    await incrementStrike(db, guildId, userId, "flood");
    await incrementStrike(db, guildId, userId, "duplicate_content");

    const { rows, nextAfter } = await listStrikes(db, guildId);

    const forUser = rows.filter((r) => r.userId === userId);
    expect(forUser).toHaveLength(2);
    expect(nextAfter).toBeUndefined();
  });

  test("userId昇順で返し、ページサイズを超える場合はnextAfterを返す", async () => {
    const userIds = Array.from({ length: 3 }, () => `u-${randomUUID()}`).sort();
    for (const userId of userIds) {
      await incrementStrike(db, guildId, userId, "flood");
    }

    const firstPage = await listStrikes(db, guildId, undefined);
    const relevantFirst = firstPage.rows.filter((r) => userIds.includes(r.userId)).map((r) => r.userId);
    expect(relevantFirst).toEqual(userIds);
    expect(firstPage.nextAfter).toBeUndefined();
  });

  test("afterを指定するとそのuserIdより後の行のみ返す", async () => {
    const userIds = Array.from({ length: 3 }, () => `u-${randomUUID()}`).sort();
    for (const userId of userIds) {
      await incrementStrike(db, guildId, userId, "flood");
    }

    const { rows } = await listStrikes(db, guildId, userIds[0]);

    expect(rows.some((r) => r.userId === userIds[0])).toBe(false);
    expect(rows.some((r) => r.userId === userIds[1])).toBe(true);
    expect(rows.some((r) => r.userId === userIds[2])).toBe(true);
  });
});

describe("getTotalStrikeCount", () => {
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

  test("violationTypeを跨いで合計を返す", async () => {
    const userId = `u-${randomUUID()}`;
    await incrementStrike(db, guildId, userId, "flood");
    await incrementStrike(db, guildId, userId, "flood");
    await incrementStrike(db, guildId, userId, "duplicate_content");

    expect(await getTotalStrikeCount(db, guildId, userId)).toBe(3);
  });

  test("行が存在しない場合は0を返す", async () => {
    const userId = `u-${randomUUID()}`;
    expect(await getTotalStrikeCount(db, guildId, userId)).toBe(0);
  });

  test("他ユーザー・他guildの行は合算しない", async () => {
    const userId = `u-${randomUUID()}`;
    const otherUserId = `u-${randomUUID()}`;
    await incrementStrike(db, guildId, userId, "flood");
    await incrementStrike(db, guildId, otherUserId, "flood");

    expect(await getTotalStrikeCount(db, guildId, userId)).toBe(1);
  });
});

describe("resetAllStrikes", () => {
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

  test("該当ユーザーの全violationType行を削除する", async () => {
    const userId = `u-${randomUUID()}`;
    await incrementStrike(db, guildId, userId, "flood");
    await incrementStrike(db, guildId, userId, "duplicate_content");

    await resetAllStrikes(db, guildId, userId);

    expect(await getTotalStrikeCount(db, guildId, userId)).toBe(0);
  });

  test("他ユーザーの行は削除しない", async () => {
    const userId = `u-${randomUUID()}`;
    const otherUserId = `u-${randomUUID()}`;
    await incrementStrike(db, guildId, userId, "flood");
    await incrementStrike(db, guildId, otherUserId, "flood");

    await resetAllStrikes(db, guildId, userId);

    expect(await getTotalStrikeCount(db, guildId, otherUserId)).toBe(1);
  });
});
