import { boolean, check, integer, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { type Column, type SQL, sql } from "drizzle-orm";
import { MODERATION_VIOLATION_TYPES } from "@management-bot/shared";
import { guilds } from "./core.js";

function violationTypeCheck(column: Column): SQL {
  return sql`${column} IN (${sql.join(
    MODERATION_VIOLATION_TYPES.map((v) => sql.raw(`'${v.replace(/'/g, "''")}'`)),
    sql.raw(", "),
  )})`;
}

export const moderationThresholds = pgTable(
  "moderation_thresholds",
  {
    guildId: text("guild_id")
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    violationType: text("violation_type").notNull(),
    preset: text("preset").notNull(),
    enabled: boolean("enabled").notNull().default(false),
  },
  (table) => [
    primaryKey({ columns: [table.guildId, table.violationType] }),
    check("moderation_thresholds_violation_type_check", violationTypeCheck(table.violationType)),
    check("moderation_thresholds_preset_check", sql`${table.preset} IN ('weak', 'medium', 'strong')`),
  ],
);

export const moderationEscalationState = pgTable(
  "moderation_escalation_state",
  {
    guildId: text("guild_id")
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    violationType: text("violation_type").notNull(),
    strikeCount: integer("strike_count").notNull().default(0),
    lastViolationAt: timestamp("last_violation_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.guildId, table.userId, table.violationType] }),
    check(
      "moderation_escalation_state_violation_type_check",
      violationTypeCheck(table.violationType),
    ),
  ],
);

export const moderationWhitelist = pgTable(
  "moderation_whitelist",
  {
    guildId: text("guild_id")
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.guildId, table.targetType, table.targetId] }),
    check("moderation_whitelist_target_type_check", sql`${table.targetType} IN ('user', 'role')`),
  ],
);
