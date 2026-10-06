ALTER TABLE "scheduled_post_settings" ADD COLUMN "allow_everyone" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "scheduled_post_settings" ADD COLUMN "allow_here" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "scheduled_posts" ADD COLUMN "mention_everyone" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "scheduled_posts" ADD COLUMN "mention_here" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "scheduled_posts" ADD COLUMN "mention_role_ids" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "scheduled_posts" ADD COLUMN "mention_user_ids" text[] DEFAULT '{}'::text[] NOT NULL;