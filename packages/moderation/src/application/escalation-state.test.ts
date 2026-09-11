import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { createDb, type Db, guilds, moderationEscalationState } from "@management-bot/db";
import { and, eq } from "drizzle-orm";
import { incrementStrike } from "./escalation-state.js";

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
