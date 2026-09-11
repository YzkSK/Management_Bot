import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createDb, type Db } from "../client.ts";
import { guilds, moderationEscalationState, moderationThresholds, moderationWhitelist } from "./index.ts";

const INVALID = "unknown" as never;

interface PgErrorCause {
  code?: string;
  constraint_name?: string;
}

async function expectConstraintViolation(operation: Promise<unknown>, constraintName: string): Promise<void> {
  try {
    await operation;
  } catch (e) {
    const cause = (e as { cause?: PgErrorCause }).cause;
    expect(cause?.constraint_name).toBe(constraintName);
    return;
  }
  throw new Error(`expected constraint "${constraintName}" violation, but the operation succeeded`);
}

describe("moderation schema", () => {
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

  test("moderation_thresholdsはguild_id+violation_typeで一意、violation_type/presetはCHECK制約で検証される", async () => {
    await db.insert(moderationThresholds).values({ guildId, violationType: "flood", preset: "medium", enabled: true });

    await expectConstraintViolation(
      db.insert(moderationThresholds).values({ guildId, violationType: "flood", preset: "weak" }),
      "moderation_thresholds_guild_id_violation_type_pk",
    );
    await expectConstraintViolation(
      db.insert(moderationThresholds).values({ guildId, violationType: INVALID, preset: "weak" }),
      "moderation_thresholds_violation_type_check",
    );
    await expectConstraintViolation(
      db.insert(moderationThresholds).values({ guildId, violationType: "duplicate_content", preset: INVALID }),
      "moderation_thresholds_preset_check",
    );
  });

  test("moderation_escalation_stateはguild_id+user_id+violation_typeで一意、violation_typeはCHECK制約で検証される", async () => {
    const userId = `test-user-${randomUUID()}`;
    await db.insert(moderationEscalationState).values({ guildId, userId, violationType: "flood", strikeCount: 1 });

    await expectConstraintViolation(
      db.insert(moderationEscalationState).values({ guildId, userId, violationType: "flood", strikeCount: 2 }),
      "moderation_escalation_state_guild_id_user_id_violation_type_pk",
    );
    await expectConstraintViolation(
      db.insert(moderationEscalationState).values({ guildId, userId, violationType: INVALID }),
      "moderation_escalation_state_violation_type_check",
    );
    await expectConstraintViolation(
      db
        .insert(moderationEscalationState)
        .values({ guildId, userId: `${userId}-2`, violationType: "flood", strikeCount: -1 }),
      "moderation_escalation_state_strike_count_check",
    );
  });

  test("moderation_whitelistはguild_id+target_type+target_idで一意、target_typeはCHECK制約で検証される", async () => {
    const targetId = `test-role-${randomUUID()}`;
    await db.insert(moderationWhitelist).values({ guildId, targetType: "role", targetId });

    await expectConstraintViolation(
      db.insert(moderationWhitelist).values({ guildId, targetType: "role", targetId }),
      "moderation_whitelist_guild_id_target_type_target_id_pk",
    );
    await expectConstraintViolation(
      db.insert(moderationWhitelist).values({ guildId, targetType: INVALID, targetId }),
      "moderation_whitelist_target_type_check",
    );
  });
});
