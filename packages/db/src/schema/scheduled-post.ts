import { check, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { type Column, type SQL, sql } from "drizzle-orm";
import {
  SCHEDULED_POST_CANCELLED_BY,
  SCHEDULED_POST_CONTENT_MAX,
  SCHEDULED_POST_FAILURE_REASONS,
  SCHEDULED_POST_STATUSES,
  type ScheduledPostCancelledBy,
  type ScheduledPostFailureReason,
  type ScheduledPostStatus,
} from "@management-bot/shared";
import { guilds } from "./core.js";

function enumCheck(column: Column, values: readonly string[]): SQL {
  return sql`${column} IN (${sql.join(
    values.map((v) => sql.raw(`'${v.replace(/'/g, "''")}'`)),
    sql.raw(", "),
  )})`;
}

/**
 * 予約投稿。statusは pending → posting → posted/failed の一方向で、遷移は必ず
 * 「WHERE id=? AND status=現在値」の条件付きUPDATEで行う(1件を1回だけ処理するため)。
 * 取り消し(cancelled)は pending からのみ。posted/failed/cancelledは30日後に削除する。
 */
export const scheduledPosts = pgTable(
  "scheduled_posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    guildId: text("guild_id")
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    channelId: text("channel_id").notNull(),
    authorId: text("author_id").notNull(),
    content: text("content").notNull(),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    status: text("status").$type<ScheduledPostStatus>().notNull().default("pending"),
    failureReason: text("failure_reason").$type<ScheduledPostFailureReason>(),
    messageId: text("message_id"),
    cancelledBy: text("cancelled_by").$type<ScheduledPostCancelledBy>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    check(
      "scheduled_posts_content_check",
      sql`char_length(${table.content}) BETWEEN 1 AND ${sql.raw(String(SCHEDULED_POST_CONTENT_MAX))}`,
    ),
    check("scheduled_posts_status_check", enumCheck(table.status, SCHEDULED_POST_STATUSES)),
    check(
      "scheduled_posts_failure_reason_check",
      sql`${table.failureReason} IS NULL OR ${enumCheck(table.failureReason, SCHEDULED_POST_FAILURE_REASONS)}`,
    ),
    check(
      "scheduled_posts_cancelled_by_check",
      sql`${table.cancelledBy} IS NULL OR ${enumCheck(table.cancelledBy, SCHEDULED_POST_CANCELLED_BY)}`,
    ),
    index("scheduled_posts_status_scheduled_at_idx").on(table.status, table.scheduledAt),
    index("scheduled_posts_guild_id_author_id_status_idx").on(table.guildId, table.authorId, table.status),
  ],
);

/** 「使えるロール」。空配列=メンバー全員が使える。 */
export const scheduledPostSettings = pgTable("scheduled_post_settings", {
  guildId: text("guild_id")
    .primaryKey()
    .references(() => guilds.id, { onDelete: "cascade" }),
  allowedRoleIds: text("allowed_role_ids")
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
