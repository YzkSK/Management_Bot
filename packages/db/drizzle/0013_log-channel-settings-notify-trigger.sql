-- log_channel_settingsの変更(INSERT/UPDATE/DELETE)時に、bot側の短命TTLキャッシュ
-- (packages/logging createChannelSettingResolver)を即時invalidateするためのpg_notify。
-- dashboard-apiでの出力先チャンネル設定変更が、bot(別プロセス)のキャッシュへ
-- TTL満了を待たず反映されるようにする。
-- guild_id/categoryは複合主キーだが、UPDATE時にこのキー自体が変わるケースは現状の
-- アプリケーションコードにはない(channel_idのみを更新するonConflictDoUpdate)。
-- それでもトリガーの契約としてキー変更を正しく扱うため、UPDATE時にOLDとNEWのキーが
-- 異なる場合は両方通知する(片方だけ通知すると旧キー側のキャッシュがTTL満了まで残る)。
CREATE FUNCTION notify_log_channel_setting_changed() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify(
    'log_channel_setting_changed',
    json_build_object(
      'guildId', COALESCE(NEW.guild_id, OLD.guild_id),
      'category', COALESCE(NEW.category, OLD.category)
    )::text
  );
  IF TG_OP = 'UPDATE' AND (NEW.guild_id, NEW.category) IS DISTINCT FROM (OLD.guild_id, OLD.category) THEN
    PERFORM pg_notify(
      'log_channel_setting_changed',
      json_build_object('guildId', OLD.guild_id, 'category', OLD.category)::text
    );
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER log_channel_settings_notify_change
AFTER INSERT OR UPDATE OR DELETE ON log_channel_settings
FOR EACH ROW EXECUTE FUNCTION notify_log_channel_setting_changed();
