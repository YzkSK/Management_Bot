CREATE TABLE "status_viewers" (
	"discord_user_id" text PRIMARY KEY NOT NULL,
	"discord_username" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
