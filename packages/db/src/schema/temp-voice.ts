import { check, index, integer, pgTable, primaryKey, text, timestamp, unique } from "drizzle-orm/pg-core";
import { type Column, type SQL, sql } from "drizzle-orm";
import { guilds } from "./core.js";

type TempVoicePermissionTargetType = "user" | "role";
type TempVoicePermissionState = "allow" | "deny";

function enumCheck(column: Column, values: readonly string[]): SQL {
  return sql`${column} IN (${sql.join(
    values.map((v) => sql.raw(`'${v.replace(/'/g, "''")}'`)),
    sql.raw(", "),
  )})`;
}

export const tempVoiceConfigs = pgTable(
  "temp_voice_configs",
  {
    guildId: text("guild_id")
      .primaryKey()
      .references(() => guilds.id, { onDelete: "cascade" }),
    // 作成用VC・カテゴリの実体がDiscord上で削除された場合、両方NULLに戻す(#412の設定チャンネル
    // 消失検知)。NULLは「未設定」と同じ扱いになり、Dashboardの「自動でセットアップ」ボタンが再表示される。
    createChannelId: text("create_channel_id"),
    categoryId: text("category_id"),
    nameTemplate: text("name_template").notNull().default("{username}のVC"),
    defaultUserLimit: integer("default_user_limit").notNull().default(0),
    defaultBitrate: integer("default_bitrate"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("temp_voice_configs_default_user_limit_check", sql`${table.defaultUserLimit} BETWEEN 0 AND 99`),
  ],
);

/**
 * gracePeriodOwnerId/gracePeriodEndsAtはオーナー不在猶予の状態を保持する。
 * 1つのVCに対して猶予状態は高々1つしか存在しないため専用テーブルに分離せずnullable列として統合している。
 * 「猶予中かどうか」はgracePeriodEndsAt IS NOT NULLで判定する。
 * channelIdはDiscordのスノーフレークで一意なため、これ自体をログ相関キーとして使う(専用UUIDは発行しない)。
 */
export const tempVoiceChannels = pgTable(
  "temp_voice_channels",
  {
    channelId: text("channel_id").primaryKey(),
    guildId: text("guild_id")
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    controlChannelId: text("control_channel_id").notNull(),
    ownerId: text("owner_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    gracePeriodOwnerId: text("grace_period_owner_id"),
    gracePeriodEndsAt: timestamp("grace_period_ends_at", { withTimezone: true }),
    /**
     * Dashboard一覧・強制削除確認ダイアログでの在室人数表示用(#415)。VoiceChannel.members.size
     * はDiscord Gateway接続(botプロセス)のキャッシュでしかREST APIには存在しないため、
     * bot側のvoiceStateUpdateごとにこの列へ同期する(多少のラグは許容、sync-member-count.ts参照)。
     */
    memberCount: integer("member_count").notNull().default(0),
  },
  (table) => [
    index("temp_voice_channels_guild_id_idx").on(table.guildId),
    index("temp_voice_channels_grace_period_ends_at_idx").on(table.gracePeriodEndsAt),
    unique("temp_voice_channels_guild_id_owner_id_key").on(table.guildId, table.ownerId),
  ],
);

export const tempVoicePermissionOverrides = pgTable(
  "temp_voice_permission_overrides",
  {
    channelId: text("channel_id")
      .notNull()
      .references(() => tempVoiceChannels.channelId, { onDelete: "cascade" }),
    targetType: text("target_type").$type<TempVoicePermissionTargetType>().notNull(),
    targetId: text("target_id").notNull(),
    state: text("state").$type<TempVoicePermissionState>().notNull(),
  },
  (table) => [
    primaryKey({
      name: "temp_voice_permission_overrides_pk",
      columns: [table.channelId, table.targetType, table.targetId],
    }),
    check("temp_voice_permission_overrides_target_type_check", enumCheck(table.targetType, ["user", "role"])),
    check("temp_voice_permission_overrides_state_check", enumCheck(table.state, ["allow", "deny"])),
  ],
);

export const tempVoiceDenyProtectedRoles = pgTable(
  "temp_voice_deny_protected_roles",
  {
    guildId: text("guild_id")
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    roleId: text("role_id").notNull(),
  },
  (table) => [primaryKey({ columns: [table.guildId, table.roleId] })],
);
