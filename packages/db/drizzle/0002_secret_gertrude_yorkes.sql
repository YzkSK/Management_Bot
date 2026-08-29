ALTER TABLE "sessions" ADD COLUMN "encrypted_access_token" text NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "encrypted_refresh_token" text NOT NULL;