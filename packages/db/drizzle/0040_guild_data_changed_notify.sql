-- Dashboardの各ページをリアルタイム更新にするためのpg_notify(issue #643)。
-- 変更内容は含めず、{guildId, topic}だけを通知する(dashboard-apiが /ws/guild/:guildId で
-- そのguildを開いている画面へ中継し、画面側がtopicに対応するtRPCクエリを取り直す)。
-- topicはトリガー引数(TG_ARGV[0])で受け取る。DELETEは削除前の行(OLD)のguild_idを使う。
-- 対象は guild_id 列を持つテーブルのみ。guild_idを持たない子テーブル
-- (temp_voice_permission_overrides等)と、botが高頻度で書き込み画面に出ないテーブル
-- (temp_voice_channels, moderation_raid_state, moderation_lockdown_channel_snapshots)は対象外。
CREATE FUNCTION notify_guild_data_changed() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify(
    'guild_data_changed',
    json_build_object(
      'guildId', CASE WHEN TG_OP = 'DELETE' THEN OLD.guild_id ELSE NEW.guild_id END,
      'topic', TG_ARGV[0]
    )::text
  );
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_logs_notify_guild_data_changed
AFTER INSERT OR UPDATE OR DELETE ON audit_logs
FOR EACH ROW EXECUTE FUNCTION notify_guild_data_changed('auditLog');
--> statement-breakpoint
CREATE TRIGGER scheduled_posts_notify_guild_data_changed
AFTER INSERT OR UPDATE OR DELETE ON scheduled_posts
FOR EACH ROW EXECUTE FUNCTION notify_guild_data_changed('scheduledPost');
--> statement-breakpoint
CREATE TRIGGER scheduled_post_settings_notify_guild_data_changed
AFTER INSERT OR UPDATE OR DELETE ON scheduled_post_settings
FOR EACH ROW EXECUTE FUNCTION notify_guild_data_changed('scheduledPost');
--> statement-breakpoint
CREATE TRIGGER temp_voice_configs_notify_guild_data_changed
AFTER INSERT OR UPDATE OR DELETE ON temp_voice_configs
FOR EACH ROW EXECUTE FUNCTION notify_guild_data_changed('tempVoice');
--> statement-breakpoint
CREATE TRIGGER temp_voice_deny_protected_roles_notify_guild_data_changed
AFTER INSERT OR UPDATE OR DELETE ON temp_voice_deny_protected_roles
FOR EACH ROW EXECUTE FUNCTION notify_guild_data_changed('tempVoice');
--> statement-breakpoint
CREATE TRIGGER moderation_thresholds_notify_guild_data_changed
AFTER INSERT OR UPDATE OR DELETE ON moderation_thresholds
FOR EACH ROW EXECUTE FUNCTION notify_guild_data_changed('moderation');
--> statement-breakpoint
CREATE TRIGGER moderation_whitelist_notify_guild_data_changed
AFTER INSERT OR UPDATE OR DELETE ON moderation_whitelist
FOR EACH ROW EXECUTE FUNCTION notify_guild_data_changed('moderation');
--> statement-breakpoint
CREATE TRIGGER moderation_ngwords_notify_guild_data_changed
AFTER INSERT OR UPDATE OR DELETE ON moderation_ngwords
FOR EACH ROW EXECUTE FUNCTION notify_guild_data_changed('moderation');
--> statement-breakpoint
CREATE TRIGGER moderation_escalation_state_notify_guild_data_changed
AFTER INSERT OR UPDATE OR DELETE ON moderation_escalation_state
FOR EACH ROW EXECUTE FUNCTION notify_guild_data_changed('moderation');
--> statement-breakpoint
CREATE TRIGGER moderation_escalation_settings_notify_guild_data_changed
AFTER INSERT OR UPDATE OR DELETE ON moderation_escalation_settings
FOR EACH ROW EXECUTE FUNCTION notify_guild_data_changed('moderation');
--> statement-breakpoint
CREATE TRIGGER moderation_lockdown_settings_notify_guild_data_changed
AFTER INSERT OR UPDATE OR DELETE ON moderation_lockdown_settings
FOR EACH ROW EXECUTE FUNCTION notify_guild_data_changed('moderation');
--> statement-breakpoint
CREATE TRIGGER log_retention_settings_notify_guild_data_changed
AFTER INSERT OR UPDATE OR DELETE ON log_retention_settings
FOR EACH ROW EXECUTE FUNCTION notify_guild_data_changed('loggingSettings');
--> statement-breakpoint
CREATE TRIGGER log_channel_settings_notify_guild_data_changed
AFTER INSERT OR UPDATE OR DELETE ON log_channel_settings
FOR EACH ROW EXECUTE FUNCTION notify_guild_data_changed('loggingSettings');
--> statement-breakpoint
CREATE TRIGGER log_display_settings_notify_guild_data_changed
AFTER INSERT OR UPDATE OR DELETE ON log_display_settings
FOR EACH ROW EXECUTE FUNCTION notify_guild_data_changed('loggingSettings');
--> statement-breakpoint
CREATE TRIGGER capability_grants_notify_guild_data_changed
AFTER INSERT OR UPDATE OR DELETE ON capability_grants
FOR EACH ROW EXECUTE FUNCTION notify_guild_data_changed('access');
