import { check, integer, jsonb, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { type Column, type SQL, sql } from "drizzle-orm";
import { guilds } from "./core.js";

/**
 * カテゴリ一覧は@management-bot/logging domain層(LOG_ENTRY_SCHEMAS)のキーと一致させること。
 * dbパッケージは機能パッケージ(logging)に依存できないため、CHECK制約として直接列挙する。
 */
export const LOG_CATEGORIES = [
  "message",
  "member",
  "role",
  "channel",
  "guild",
  "thread",
  "invite",
  "emoji",
  "autoMod",
  "integration",
  "poll",
  "scheduledEvent",
  "stage",
  "auditLogCorrelation",
  "moderationCase",
] as const;

function categoryCheck(column: Column): SQL {
  return sql`${column} IN (${sql.join(
    LOG_CATEGORIES.map((c) => sql.raw(`'${c}'`)),
    sql.raw(", "),
  )})`;
}

export const logEntries = pgTable(
  "log_entries",
  {
    id: text("id").primaryKey(),
    guildId: text("guild_id")
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    category: text("category").notNull(),
    payload: jsonb("payload").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [check("log_entries_category_check", categoryCheck(table.category))],
);

export const logRetentionSettings = pgTable(
  "log_retention_settings",
  {
    guildId: text("guild_id")
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    category: text("category").notNull(),
    retentionDays: integer("retention_days").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.guildId, table.category] }),
    check("log_retention_settings_category_check", categoryCheck(table.category)),
    check("log_retention_settings_retention_days_check", sql`${table.retentionDays} >= 0`),
  ],
);

export const logChannelSettings = pgTable(
  "log_channel_settings",
  {
    guildId: text("guild_id")
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    category: text("category").notNull(),
    channelId: text("channel_id").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.guildId, table.category] }),
    check("log_channel_settings_category_check", categoryCheck(table.category)),
  ],
);
