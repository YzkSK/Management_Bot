import { boolean, check, index, integer, jsonb, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
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
    /** payload.actorIsBotの複製。jsonb内条件でのフィルタを避けるためカラム化する(hideBotEvents用)。 */
    authorIsBot: boolean("author_is_bot").notNull().default(false),
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
    index("log_entries_guild_created_at_id_idx").on(
      table.guildId,
      table.createdAt,
      table.id,
    ),
    /**
     * hideBotEvents=true(デフォルト)時のlistLogEntriesはauthor_is_bot=falseで絞った上で
     * created_at,id降順ページングを行う。上記の非部分インデックスだけだとBotログが多いguildで
     * フィルタ走査が発生するため、デフォルト系の絞り込みに合わせた部分インデックスを別途持つ(codexレビュー指摘)。
     */
    index("log_entries_visible_guild_created_at_id_idx")
      .on(table.guildId, table.createdAt, table.id)
      .where(sql`${table.authorIsBot} = false`),
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

export const logDisplaySettings = pgTable("log_display_settings", {
  guildId: text("guild_id")
    .primaryKey()
    .references(() => guilds.id, { onDelete: "cascade" }),
  /** trueの場合、auditLogCorrelationカテゴリの生ログをダッシュボードの一覧表示から除外する。 */
  hideAuditLogCorrelation: boolean("hide_audit_log_correlation").notNull().default(true),
  /** trueの場合、Botアカウントが主体のログ(authorIsBot=true)をダッシュボードの一覧表示から除外する。 */
  hideBotEvents: boolean("hide_bot_events").notNull().default(true),
});
