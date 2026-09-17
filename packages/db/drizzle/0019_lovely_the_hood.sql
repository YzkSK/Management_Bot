CREATE TABLE "moderation_raid_state" (
	"guild_id" text PRIMARY KEY NOT NULL,
	"incident_count" integer DEFAULT 0 NOT NULL,
	"last_raid_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "moderation_raid_state_incident_count_check" CHECK ("moderation_raid_state"."incident_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "moderation_escalation_state" DROP CONSTRAINT "moderation_escalation_state_violation_type_check";--> statement-breakpoint
ALTER TABLE "moderation_thresholds" DROP CONSTRAINT "moderation_thresholds_violation_type_check";--> statement-breakpoint
ALTER TABLE "moderation_raid_state" ADD CONSTRAINT "moderation_raid_state_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_escalation_state" ADD CONSTRAINT "moderation_escalation_state_violation_type_check" CHECK ("moderation_escalation_state"."violation_type" IN ('flood', 'duplicate_content', 'ngword', 'mention_spam', 'invite_link', 'new_account_guard'));--> statement-breakpoint
ALTER TABLE "moderation_thresholds" ADD CONSTRAINT "moderation_thresholds_violation_type_check" CHECK ("moderation_thresholds"."violation_type" IN ('flood', 'duplicate_content', 'ngword', 'mention_spam', 'invite_link', 'raid', 'new_account_guard'));