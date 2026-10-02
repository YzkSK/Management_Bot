CREATE TABLE "activity_daily" (
	"guild_id" text NOT NULL,
	"user_id" text NOT NULL,
	"day" date NOT NULL,
	"message_count" integer DEFAULT 0 NOT NULL,
	"voice_seconds" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "activity_daily_guild_id_user_id_day_pk" PRIMARY KEY("guild_id","user_id","day"),
	CONSTRAINT "activity_daily_non_negative" CHECK ("activity_daily"."message_count" >= 0 AND "activity_daily"."voice_seconds" >= 0)
);
--> statement-breakpoint
CREATE TABLE "activity_hourly" (
	"guild_id" text NOT NULL,
	"user_id" text NOT NULL,
	"hour" timestamp with time zone NOT NULL,
	"message_count" integer DEFAULT 0 NOT NULL,
	"voice_seconds" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "activity_hourly_guild_id_user_id_hour_pk" PRIMARY KEY("guild_id","user_id","hour"),
	CONSTRAINT "activity_hourly_non_negative" CHECK ("activity_hourly"."message_count" >= 0 AND "activity_hourly"."voice_seconds" >= 0)
);
--> statement-breakpoint
ALTER TABLE "activity_daily" ADD CONSTRAINT "activity_daily_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_hourly" ADD CONSTRAINT "activity_hourly_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_daily_guild_day_idx" ON "activity_daily" USING btree ("guild_id","day");--> statement-breakpoint
CREATE INDEX "activity_hourly_guild_hour_idx" ON "activity_hourly" USING btree ("guild_id","hour");