CREATE TABLE "log_channel_settings" (
	"guild_id" text NOT NULL,
	"category" text NOT NULL,
	"channel_id" text NOT NULL,
	CONSTRAINT "log_channel_settings_guild_id_category_pk" PRIMARY KEY("guild_id","category"),
	CONSTRAINT "log_channel_settings_category_check" CHECK ("log_channel_settings"."category" IN ('message', 'member', 'role', 'channel', 'guild', 'thread', 'invite', 'emoji', 'autoMod', 'integration', 'poll', 'scheduledEvent', 'stage', 'auditLogCorrelation', 'moderationCase'))
);
--> statement-breakpoint
CREATE TABLE "log_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"category" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "log_entries_category_check" CHECK ("log_entries"."category" IN ('message', 'member', 'role', 'channel', 'guild', 'thread', 'invite', 'emoji', 'autoMod', 'integration', 'poll', 'scheduledEvent', 'stage', 'auditLogCorrelation', 'moderationCase'))
);
--> statement-breakpoint
CREATE TABLE "log_retention_settings" (
	"guild_id" text NOT NULL,
	"category" text NOT NULL,
	"retention_days" integer NOT NULL,
	CONSTRAINT "log_retention_settings_guild_id_category_pk" PRIMARY KEY("guild_id","category"),
	CONSTRAINT "log_retention_settings_category_check" CHECK ("log_retention_settings"."category" IN ('message', 'member', 'role', 'channel', 'guild', 'thread', 'invite', 'emoji', 'autoMod', 'integration', 'poll', 'scheduledEvent', 'stage', 'auditLogCorrelation', 'moderationCase')),
	CONSTRAINT "log_retention_settings_retention_days_check" CHECK ("log_retention_settings"."retention_days" >= 0)
);
--> statement-breakpoint
ALTER TABLE "log_channel_settings" ADD CONSTRAINT "log_channel_settings_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "log_entries" ADD CONSTRAINT "log_entries_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "log_retention_settings" ADD CONSTRAINT "log_retention_settings_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "log_entries_guild_category_created_at_idx" ON "log_entries" USING btree ("guild_id","category","created_at");