CREATE TABLE "log_display_settings" (
	"guild_id" text PRIMARY KEY NOT NULL,
	"hide_audit_log_correlation" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "log_display_settings" ADD CONSTRAINT "log_display_settings_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;