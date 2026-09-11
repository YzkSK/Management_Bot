CREATE TABLE "moderation_escalation_state" (
	"guild_id" text NOT NULL,
	"user_id" text NOT NULL,
	"violation_type" text NOT NULL,
	"strike_count" integer DEFAULT 0 NOT NULL,
	"last_violation_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "moderation_escalation_state_guild_id_user_id_violation_type_pk" PRIMARY KEY("guild_id","user_id","violation_type"),
	CONSTRAINT "moderation_escalation_state_violation_type_check" CHECK ("moderation_escalation_state"."violation_type" IN ('flood', 'duplicate_content')),
	CONSTRAINT "moderation_escalation_state_strike_count_check" CHECK ("moderation_escalation_state"."strike_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "moderation_thresholds" (
	"guild_id" text NOT NULL,
	"violation_type" text NOT NULL,
	"preset" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	CONSTRAINT "moderation_thresholds_guild_id_violation_type_pk" PRIMARY KEY("guild_id","violation_type"),
	CONSTRAINT "moderation_thresholds_violation_type_check" CHECK ("moderation_thresholds"."violation_type" IN ('flood', 'duplicate_content')),
	CONSTRAINT "moderation_thresholds_preset_check" CHECK ("moderation_thresholds"."preset" IN ('weak', 'medium', 'strong'))
);
--> statement-breakpoint
CREATE TABLE "moderation_whitelist" (
	"guild_id" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	CONSTRAINT "moderation_whitelist_guild_id_target_type_target_id_pk" PRIMARY KEY("guild_id","target_type","target_id"),
	CONSTRAINT "moderation_whitelist_target_type_check" CHECK ("moderation_whitelist"."target_type" IN ('user', 'role')),
	CONSTRAINT "moderation_whitelist_no_everyone_check" CHECK (NOT ("moderation_whitelist"."target_type" = 'role' AND "moderation_whitelist"."target_id" = "moderation_whitelist"."guild_id"))
);
--> statement-breakpoint
ALTER TABLE "moderation_escalation_state" ADD CONSTRAINT "moderation_escalation_state_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_thresholds" ADD CONSTRAINT "moderation_thresholds_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_whitelist" ADD CONSTRAINT "moderation_whitelist_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;