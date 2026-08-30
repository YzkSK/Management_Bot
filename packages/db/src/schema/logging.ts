import { check, index, integer, jsonb, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { type Column, type SQL, sql } from "drizzle-orm";
import { LOG_CATEGORIES } from "@management-bot/shared";
import { guilds } from "./core.js";

function categoryCheck(column: Column): SQL {
  return sql`${column} IN (${sql.join(
    LOG_CATEGORIES.map((c) => sql.raw(`'${c.replace(/'/g, "''")}'`)),
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
  (table) => [
    check("log_entries_category_check", categoryCheck(table.category)),
    index("log_entries_guild_category_created_at_idx").on(
      table.guildId,
      table.category,
      table.createdAt,
    ),
  ],
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
