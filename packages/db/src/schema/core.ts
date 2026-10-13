import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const guilds = pgTable("guilds", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const guildConfigs = pgTable("guild_configs", {
  guildId: text("guild_id")
    .primaryKey()
    .references(() => guilds.id, { onDelete: "cascade" }),
  config: jsonb("config").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const dashboardAccessGrants = pgTable("dashboard_access_grants", {
  id: text("id").primaryKey(),
  guildId: text("guild_id")
    .notNull()
    .references(() => guilds.id, { onDelete: "cascade" }),
  discordUserId: text("discord_user_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  discordUserId: text("discord_user_id").notNull(),
  discordUsername: text("discord_username").notNull(),
  encryptedAccessToken: text("encrypted_access_token").notNull(),
  encryptedRefreshToken: text("encrypted_refresh_token").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const features = pgTable("features", {
  key: text("key").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
});

export const guildFeatureToggles = pgTable(
  "guild_feature_toggles",
  {
    guildId: text("guild_id")
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    featureKey: text("feature_key")
      .notNull()
      .references(() => features.key, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(false),
  },
  (table) => [primaryKey({ columns: [table.guildId, table.featureKey] })],
);

/**
 * ギルド内のuser/roleに対する実効capabilities付与。
 * targetType='role'の@everyone権限はDiscordの仕様上roleId===guildIdとなるレコードで表現する。
 */
export const capabilityGrants = pgTable(
  "capability_grants",
  {
    id: text("id").primaryKey(),
    guildId: text("guild_id")
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    capabilities: integer("capabilities").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique().on(table.guildId, table.targetType, table.targetId),
    check("target_type_check", sql`${table.targetType} IN ('user', 'role')`),
  ],
);

/**
 * Bot全体ステータス画面(issue #507)の閲覧を許可されたユーザー。Botオーナーは
 * Discord APIから自動判定するためここには保存しない。表示名は追加時点のものを保持する。
 */
export const statusViewers = pgTable("status_viewers", {
  discordUserId: text("discord_user_id").primaryKey(),
  discordUsername: text("discord_username").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * 操作履歴・アクセス履歴(issue #618)。追記専用で、UPDATE/DELETEはDBトリガーで制限する
 * (pending→確定の1回のoutcome更新と、保存期間切れ行の削除のみ許可。マイグレーション参照)。
 * guildsへのFKは張らない: ギルド削除のcascadeで履歴が消える/追記専用トリガーと衝突するため。
 * actor_idがNULLの行はBot自身の自動操作を表す。
 */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: text("id").primaryKey(),
    guildId: text("guild_id").notNull(),
    kind: text("kind").notNull(),
    actorId: text("actor_id"),
    actorName: text("actor_name").notNull(),
    feature: text("feature").notNull(),
    action: text("action").notNull(),
    outcome: text("outcome").notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("audit_logs_guild_created_at_idx").on(table.guildId, table.createdAt.desc()),
    check("audit_logs_kind_check", sql`${table.kind} IN ('action', 'access')`),
    check("audit_logs_outcome_check", sql`${table.outcome} IN ('pending', 'success', 'failure', 'denied')`),
  ],
);
