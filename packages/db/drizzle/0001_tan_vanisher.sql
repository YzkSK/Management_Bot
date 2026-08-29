CREATE TABLE "capability_grants" (
	"id" text PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"capabilities" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "capability_grants_guild_id_target_type_target_id_unique" UNIQUE("guild_id","target_type","target_id"),
	CONSTRAINT "target_type_check" CHECK ("capability_grants"."target_type" IN ('user', 'role'))
);
--> statement-breakpoint
ALTER TABLE "capability_grants" ADD CONSTRAINT "capability_grants_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;