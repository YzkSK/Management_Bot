import { boolean, check, index, integer, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { type Column, type SQL, sql } from "drizzle-orm";
import {
  MODERATION_ESCALATION_VIOLATION_TYPES,
  MODERATION_PRESETS,
  MODERATION_VIOLATION_TYPES,
  type ModerationEscalationViolationType,
  type ModerationPreset,
  type ModerationViolationType,
} from "@management-bot/shared";
import { guilds } from "./core.js";

type ModerationWhitelistTargetType = "user" | "role";
type ModerationNgwordMatchType = "exact" | "contains" | "regex";

const MODERATION_NGWORD_MATCH_TYPES = ["exact", "contains", "regex"] as const;

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
    violationType: text("violation_type").$type<ModerationEscalationViolationType>().notNull(),
    strikeCount: integer("strike_count").notNull().default(0),
    lastViolationAt: timestamp("last_violation_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.guildId, table.userId, table.violationType] }),
    check(
      "moderation_escalation_state_violation_type_check",
      enumCheck(table.violationType, MODERATION_ESCALATION_VIOLATION_TYPES),
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

export const moderationNgwords = pgTable(
  "moderation_ngwords",
  {
    id: text("id").primaryKey(),
    guildId: text("guild_id")
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    matchType: text("match_type").$type<ModerationNgwordMatchType>().notNull(),
    pattern: text("pattern").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("moderation_ngwords_match_type_check", enumCheck(table.matchType, MODERATION_NGWORD_MATCH_TYPES)),
    index("moderation_ngwords_guild_id_idx").on(table.guildId),
  ],
);

export const moderationRaidState = pgTable(
  "moderation_raid_state",
  {
    guildId: text("guild_id")
      .primaryKey()
      .references(() => guilds.id, { onDelete: "cascade" }),
    incidentCount: integer("incident_count").notNull().default(0),
    lastRaidAt: timestamp("last_raid_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [check("moderation_raid_state_incident_count_check", sql`${table.incidentCount} >= 0`)],
);

export const moderationEscalationSettings = pgTable(
  "moderation_escalation_settings",
  {
    guildId: text("guild_id")
      .primaryKey()
      .references(() => guilds.id, { onDelete: "cascade" }),
    preset: text("preset").$type<ModerationPreset>().notNull().default("medium"),
  },
  (table) => [
    check(
      "moderation_escalation_settings_preset_check",
      enumCheck(table.preset, MODERATION_PRESETS),
    ),
  ],
);

/**
 * モデレーション処理がDiscordへ削除を依頼する直前に保存する、メッセージIDとcaseIdの短期対応表。
 * GatewayのmessageDeleteBulkは元の処分操作を持たないため、logging側が因果関係を復元するために使う。
 */
export const moderationMessageDeletionLinks = pgTable(
  "moderation_message_deletion_links",
  {
    guildId: text("guild_id")
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    messageId: text("message_id").notNull(),
    caseId: text("case_id").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.guildId, table.messageId] }),
    index("moderation_message_deletion_links_expires_at_idx").on(table.expiresAt),
  ],
);
