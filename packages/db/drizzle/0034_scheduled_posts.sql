CREATE TABLE "scheduled_post_settings" (
	"guild_id" text PRIMARY KEY NOT NULL,
	"allowed_role_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduled_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"author_id" text NOT NULL,
	"content" text NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"failure_reason" text,
	"message_id" text,
	"cancelled_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "scheduled_posts_content_check" CHECK (char_length("scheduled_posts"."content") BETWEEN 1 AND 2000),
	CONSTRAINT "scheduled_posts_status_check" CHECK ("scheduled_posts"."status" IN ('pending', 'posting', 'posted', 'failed', 'cancelled')),
	CONSTRAINT "scheduled_posts_failure_reason_check" CHECK ("scheduled_posts"."failure_reason" IS NULL OR "scheduled_posts"."failure_reason" IN ('author_left', 'no_permission', 'no_role', 'channel_deleted', 'bot_missing_permission', 'thread_archived', 'expired', 'unknown_result', 'send_failed')),
	CONSTRAINT "scheduled_posts_cancelled_by_check" CHECK ("scheduled_posts"."cancelled_by" IS NULL OR "scheduled_posts"."cancelled_by" IN ('author', 'admin'))
);
--> statement-breakpoint
ALTER TABLE "log_channel_settings" DROP CONSTRAINT "log_channel_settings_category_check";--> statement-breakpoint
ALTER TABLE "log_entries" DROP CONSTRAINT "log_entries_category_check";--> statement-breakpoint
ALTER TABLE "log_retention_settings" DROP CONSTRAINT "log_retention_settings_category_check";--> statement-breakpoint
ALTER TABLE "scheduled_post_settings" ADD CONSTRAINT "scheduled_post_settings_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_posts" ADD CONSTRAINT "scheduled_posts_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scheduled_posts_status_scheduled_at_idx" ON "scheduled_posts" USING btree ("status","scheduled_at");--> statement-breakpoint
CREATE INDEX "scheduled_posts_guild_id_author_id_status_idx" ON "scheduled_posts" USING btree ("guild_id","author_id","status");--> statement-breakpoint
ALTER TABLE "log_channel_settings" ADD CONSTRAINT "log_channel_settings_category_check" CHECK ("log_channel_settings"."category" IN ('message', 'reaction', 'member', 'role', 'channel', 'guild', 'thread', 'invite', 'emoji', 'sticker', 'autoMod', 'integration', 'poll', 'scheduledEvent', 'stage', 'auditLogCorrelation', 'moderationCase', 'voice', 'tempVoice', 'scheduledPost'));--> statement-breakpoint
ALTER TABLE "log_entries" ADD CONSTRAINT "log_entries_category_check" CHECK ("log_entries"."category" IN ('message', 'reaction', 'member', 'role', 'channel', 'guild', 'thread', 'invite', 'emoji', 'sticker', 'autoMod', 'integration', 'poll', 'scheduledEvent', 'stage', 'auditLogCorrelation', 'moderationCase', 'voice', 'tempVoice', 'scheduledPost'));--> statement-breakpoint
ALTER TABLE "log_retention_settings" ADD CONSTRAINT "log_retention_settings_category_check" CHECK ("log_retention_settings"."category" IN ('message', 'reaction', 'member', 'role', 'channel', 'guild', 'thread', 'invite', 'emoji', 'sticker', 'autoMod', 'integration', 'poll', 'scheduledEvent', 'stage', 'auditLogCorrelation', 'moderationCase', 'voice', 'tempVoice', 'scheduledPost'));