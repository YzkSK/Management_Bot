import { boolean, check, integer, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { type Column, type SQL, sql } from "drizzle-orm";
import {
  MODERATION_PRESETS,
  MODERATION_VIOLATION_TYPES,
  type ModerationPreset,
  type ModerationViolationType,
} from "@management-bot/shared";
import { guilds } from "./core.js";

type ModerationWhitelistTargetType = "user" | "role";

function enumCheck(column: Column, values: readonly string[]): SQL {
  return sql`${column} IN (${sql.join(
    values.map((v) => sql.raw(`'${v.replace(/'/g, "''")}'`)),
    sql.raw(", "),
  )})`;
}

export const moderationThresholds = pgTable(
  "moderation_thresholds",
  {
    guildId: text("guild_id")
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    violationType: text("violation_type").$type<ModerationViolationType>().notNull(),
    preset: text("preset").$type<ModerationPreset>().notNull(),
    enabled: boolean("enabled").notNull().default(false),
  },
  (table) => [
    primaryKey({ columns: [table.guildId, table.violationType] }),
    check(
      "moderation_thresholds_violation_type_check",
      enumCheck(table.violationType, MODERATION_VIOLATION_TYPES),
    ),
    check("moderation_thresholds_preset_check", enumCheck(table.preset, MODERATION_PRESETS)),
  ],
);

export const moderationEscalationState = pgTable(
  "moderation_escalation_state",
  {
    guildId: text("guild_id")
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    violationType: text("violation_type").$type<ModerationViolationType>().notNull(),
    strikeCount: integer("strike_count").notNull().default(0),
    lastViolationAt: timestamp("last_violation_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.guildId, table.userId, table.violationType] }),
    check(
      "moderation_escalation_state_violation_type_check",
      enumCheck(table.violationType, MODERATION_VIOLATION_TYPES),
    ),
    check("moderation_escalation_state_strike_count_check", sql`${table.strikeCount} >= 0`),
  ],
);

export const moderationWhitelist = pgTable(
  "moderation_whitelist",
  {
    guildId: text("guild_id")
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    targetType: text("target_type").$type<ModerationWhitelistTargetType>().notNull(),
    targetId: text("target_id").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.guildId, table.targetType, table.targetId] }),
    check("moderation_whitelist_target_type_check", enumCheck(table.targetType, ["user", "role"])),
    /**
     * `@everyone`(targetType=role, targetId=guildId)は全メンバーが持つロールのため、
     * ホワイトリスト化するとモデレーション機能が実質的に全停止してしまう(codexレビュー対応)。
     * router層でも追加を拒否しているが、直接のDB書き込みでも成立しないよう制約で防ぐ。
     */
    check(
      "moderation_whitelist_no_everyone_check",
      sql`NOT (${table.targetType} = 'role' AND ${table.targetId} = ${table.guildId})`,
    ),
  ],
);
