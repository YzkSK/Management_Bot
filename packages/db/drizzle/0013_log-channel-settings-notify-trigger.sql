-- log_channel_settingsの変更(INSERT/UPDATE/DELETE)時に、bot側の短命TTLキャッシュ
-- (packages/logging createChannelSettingResolver)を即時invalidateするためのpg_notify。
-- dashboard-apiでの出力先チャンネル設定変更が、bot(別プロセス)のキャッシュへ
-- TTL満了を待たず反映されるようにする。
CREATE FUNCTION notify_log_channel_setting_changed() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify(
    'log_channel_setting_changed',
    json_build_object(
      'guildId', COALESCE(NEW.guild_id, OLD.guild_id),
      'category', COALESCE(NEW.category, OLD.category)
    )::text
  );
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER log_channel_settings_notify_change
AFTER INSERT OR UPDATE OR DELETE ON log_channel_settings
FOR EACH ROW EXECUTE FUNCTION notify_log_channel_setting_changed();
