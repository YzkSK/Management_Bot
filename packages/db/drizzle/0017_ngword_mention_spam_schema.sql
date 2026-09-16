CREATE TABLE "moderation_ngwords" (
	"id" text PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"match_type" text NOT NULL,
	"pattern" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "moderation_ngwords_match_type_check" CHECK ("moderation_ngwords"."match_type" IN ('exact', 'contains', 'regex'))
);
--> statement-breakpoint
ALTER TABLE "moderation_ngwords" ADD CONSTRAINT "moderation_ngwords_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "moderation_ngwords_guild_id_idx" ON "moderation_ngwords" USING btree ("guild_id");--> statement-breakpoint
ALTER TABLE "moderation_thresholds" DROP CONSTRAINT "moderation_thresholds_violation_type_check";--> statement-breakpoint
ALTER TABLE "moderation_escalation_state" DROP CONSTRAINT "moderation_escalation_state_violation_type_check";--> statement-breakpoint
ALTER TABLE "moderation_thresholds" ADD CONSTRAINT "moderation_thresholds_violation_type_check" CHECK ("moderation_thresholds"."violation_type" IN ('flood', 'duplicate_content', 'ngword', 'mention_spam'));--> statement-breakpoint
ALTER TABLE "moderation_escalation_state" ADD CONSTRAINT "moderation_escalation_state_violation_type_check" CHECK ("moderation_escalation_state"."violation_type" IN ('flood', 'duplicate_content', 'ngword', 'mention_spam'));