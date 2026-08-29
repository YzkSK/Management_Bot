import {
  boolean,
  check,
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
