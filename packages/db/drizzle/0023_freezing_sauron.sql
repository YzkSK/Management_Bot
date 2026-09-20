CREATE TABLE "moderation_lockdown_channel_snapshots" (
	"guild_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"send_messages" boolean,
	CONSTRAINT "moderation_lockdown_channel_snapshots_guild_id_channel_id_pk" PRIMARY KEY("guild_id","channel_id")
);
--> statement-breakpoint
CREATE TABLE "moderation_lockdown_settings" (
	"guild_id" text PRIMARY KEY NOT NULL,
	"auto_lockdown_on_raid" boolean DEFAULT false NOT NULL,
	"requested_locked" boolean DEFAULT false NOT NULL,
	"is_locked" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "moderation_lockdown_channel_snapshots" ADD CONSTRAINT "moderation_lockdown_channel_snapshots_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_lockdown_settings" ADD CONSTRAINT "moderation_lockdown_settings_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE FUNCTION notify_moderation_lockdown_changed() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify(
    'moderation_config_changed',
    json_build_object('guildId', COALESCE(NEW.guild_id, OLD.guild_id))::text
  );
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER moderation_lockdown_settings_notify_change
AFTER INSERT OR UPDATE OR DELETE ON moderation_lockdown_settings
FOR EACH ROW EXECUTE FUNCTION notify_moderation_lockdown_changed();
