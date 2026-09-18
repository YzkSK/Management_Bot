-- moderation_thresholds/moderation_whitelist/moderation_ngwordsの変更(INSERT/UPDATE/DELETE)時に、
-- bot側の短命TTLキャッシュ(packages/moderation moderation-config-cache.ts、#352)を即時invalidateする
-- ためのpg_notify。dashboard-apiでの設定変更が、bot(別プロセス)のキャッシュへTTL満了を待たず
-- 反映されるようにする(#353)。3テーブルとも同じチャンネル(moderation_config_changed)に
-- guildIdのみを通知する(configCacheはguild単位のスナップショットのため、どのテーブルが
-- 変わったかを区別する必要がない)。guild_idは主キーの一部だが、外部キー参照先(guilds.id)自体が
-- 不変であるべき値のためUPDATEでの変更は想定しない(0013と異なりOLD/NEW両方の通知は行わない)。
CREATE FUNCTION notify_moderation_config_changed() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify(
    'moderation_config_changed',
    json_build_object('guildId', COALESCE(NEW.guild_id, OLD.guild_id))::text
  );
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER moderation_thresholds_notify_change
AFTER INSERT OR UPDATE OR DELETE ON moderation_thresholds
FOR EACH ROW EXECUTE FUNCTION notify_moderation_config_changed();
--> statement-breakpoint
CREATE TRIGGER moderation_whitelist_notify_change
AFTER INSERT OR UPDATE OR DELETE ON moderation_whitelist
FOR EACH ROW EXECUTE FUNCTION notify_moderation_config_changed();
--> statement-breakpoint
CREATE TRIGGER moderation_ngwords_notify_change
AFTER INSERT OR UPDATE OR DELETE ON moderation_ngwords
FOR EACH ROW EXECUTE FUNCTION notify_moderation_config_changed();
