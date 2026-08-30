CREATE TABLE "dashboard_access_grants" (
	"id" text PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"discord_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "features" (
	"key" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guild_configs" (
	"guild_id" text PRIMARY KEY NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guild_feature_toggles" (
	"guild_id" text NOT NULL,
	"feature_key" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	CONSTRAINT "guild_feature_toggles_guild_id_feature_key_pk" PRIMARY KEY("guild_id","feature_key")
);
--> statement-breakpoint
CREATE TABLE "guilds" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"discord_user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dashboard_access_grants" ADD CONSTRAINT "dashboard_access_grants_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_configs" ADD CONSTRAINT "guild_configs_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_feature_toggles" ADD CONSTRAINT "guild_feature_toggles_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_feature_toggles" ADD CONSTRAINT "guild_feature_toggles_feature_key_features_key_fk" FOREIGN KEY ("feature_key") REFERENCES "public"."features"("key") ON DELETE cascade ON UPDATE no action;