import { check, date, index, integer, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { guilds } from "./core.js";

/**
 * 時間単位の活動集計(アクティビティモニター)。hourはUTCの時間先頭。
 * 90日超の行はapps/activity-rollupがactivity_dailyへ移して削除する。メッセージ本文は保存しない。
 */
export const activityHourly = pgTable(
  "activity_hourly",
  {
    guildId: text("guild_id")
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    hour: timestamp("hour", { withTimezone: true }).notNull(),
    messageCount: integer("message_count").notNull().default(0),
    voiceSeconds: integer("voice_seconds").notNull().default(0),
    /** その時間内の最終発言/最終VC計上時刻(秒精度の「最終活動」表示用)。導入前の行はNULL。 */
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    lastVoiceAt: timestamp("last_voice_at", { withTimezone: true }),
  },
  (table) => [
    primaryKey({ columns: [table.guildId, table.userId, table.hour] }),
    index("activity_hourly_guild_hour_idx").on(table.guildId, table.hour),
    check("activity_hourly_non_negative", sql`${table.messageCount} >= 0 AND ${table.voiceSeconds} >= 0`),
  ],
);

/** activity_hourlyを日次(Asia/Tokyoの日付)へロールアップした長期保存用。 */
export const activityDaily = pgTable(
  "activity_daily",
  {
    guildId: text("guild_id")
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    day: date("day", { mode: "string" }).notNull(),
    messageCount: integer("message_count").notNull().default(0),
    voiceSeconds: integer("voice_seconds").notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.guildId, table.userId, table.day] }),
    index("activity_daily_guild_day_idx").on(table.guildId, table.day),
    check("activity_daily_non_negative", sql`${table.messageCount} >= 0 AND ${table.voiceSeconds} >= 0`),
  ],
);
