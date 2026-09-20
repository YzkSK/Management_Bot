CREATE TABLE "moderation_message_deletion_links" (
	"guild_id" text NOT NULL,
	"message_id" text NOT NULL,
	"case_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "moderation_message_deletion_links_guild_id_message_id_pk" PRIMARY KEY("guild_id","message_id")
);
--> statement-breakpoint
ALTER TABLE "moderation_message_deletion_links" ADD CONSTRAINT "moderation_message_deletion_links_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "moderation_message_deletion_links_expires_at_idx" ON "moderation_message_deletion_links" USING btree ("expires_at");