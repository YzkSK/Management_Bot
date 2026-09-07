DELETE FROM "sessions";--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "discord_username" text NOT NULL;