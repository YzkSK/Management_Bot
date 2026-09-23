CREATE TABLE "temp_voice_channels" (
	"channel_id" text PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"control_channel_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"grace_period_owner_id" text,
	"grace_period_ends_at" timestamp with time zone,
	CONSTRAINT "temp_voice_channels_guild_id_owner_id_key" UNIQUE("guild_id","owner_id")
);
--> statement-breakpoint
CREATE TABLE "temp_voice_configs" (
	"guild_id" text PRIMARY KEY NOT NULL,
	"create_channel_id" text NOT NULL,
	"category_id" text NOT NULL,
	"name_template" text DEFAULT '{username}のVC' NOT NULL,
	"default_user_limit" integer DEFAULT 0 NOT NULL,
	"default_bitrate" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "temp_voice_configs_default_user_limit_check" CHECK ("temp_voice_configs"."default_user_limit" BETWEEN 0 AND 99)
);
--> statement-breakpoint
CREATE TABLE "temp_voice_deny_protected_roles" (
	"guild_id" text NOT NULL,
	"role_id" text NOT NULL,
	CONSTRAINT "temp_voice_deny_protected_roles_guild_id_role_id_pk" PRIMARY KEY("guild_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "temp_voice_permission_overrides" (
	"channel_id" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"state" text NOT NULL,
	CONSTRAINT "temp_voice_permission_overrides_pk" PRIMARY KEY("channel_id","target_type","target_id"),
	CONSTRAINT "temp_voice_permission_overrides_target_type_check" CHECK ("temp_voice_permission_overrides"."target_type" IN ('user', 'role')),
	CONSTRAINT "temp_voice_permission_overrides_state_check" CHECK ("temp_voice_permission_overrides"."state" IN ('allow', 'deny'))
);
--> statement-breakpoint
ALTER TABLE "temp_voice_channels" ADD CONSTRAINT "temp_voice_channels_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "temp_voice_configs" ADD CONSTRAINT "temp_voice_configs_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "temp_voice_deny_protected_roles" ADD CONSTRAINT "temp_voice_deny_protected_roles_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "temp_voice_permission_overrides" ADD CONSTRAINT "temp_voice_permission_overrides_channel_id_temp_voice_channels_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."temp_voice_channels"("channel_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "temp_voice_channels_guild_id_idx" ON "temp_voice_channels" USING btree ("guild_id");--> statement-breakpoint
CREATE INDEX "temp_voice_channels_grace_period_ends_at_idx" ON "temp_voice_channels" USING btree ("grace_period_ends_at");