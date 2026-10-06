ALTER TABLE "scheduled_posts" ADD COLUMN "cancelled_by_user_id" text;--> statement-breakpoint
ALTER TABLE "scheduled_posts" ADD COLUMN "cancelled_by_user_name" text;--> statement-breakpoint
ALTER TABLE "scheduled_posts" ADD COLUMN "cancel_notified_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "scheduled_posts_admin_cancel_unnotified_idx" ON "scheduled_posts" USING btree ("id") WHERE "scheduled_posts"."status" = 'cancelled' AND "scheduled_posts"."cancelled_by" = 'admin' AND "scheduled_posts"."cancel_notified_at" IS NULL;