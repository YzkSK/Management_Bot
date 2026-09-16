CREATE TABLE "moderation_escalation_settings" (
	"guild_id" text PRIMARY KEY NOT NULL,
	"preset" text DEFAULT 'medium' NOT NULL,
	CONSTRAINT "moderation_escalation_settings_preset_check" CHECK ("moderation_escalation_settings"."preset" IN ('weak', 'medium', 'strong'))
);
--> statement-breakpoint
ALTER TABLE "moderation_escalation_settings" ADD CONSTRAINT "moderation_escalation_settings_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;