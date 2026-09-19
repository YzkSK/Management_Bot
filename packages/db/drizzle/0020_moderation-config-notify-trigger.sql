-- moderation_thresholds/moderation_whitelist/moderation_ngwordsの変更(INSERT/UPDATE/DELETE)時に、
-- bot側の短命TTLキャッシュ(packages/moderation moderation-config-cache.ts、#352)を即時invalidateする
-- ためのpg_notify。dashboard-apiでの設定変更が、bot(別プロセス)のキャッシュへTTL満了を待たず
-- 反映されるようにする(#353)。3テーブルとも同じチャンネル(moderation_config_changed)に
-- guildIdのみを通知する(configCacheはguild単位のスナップショットのため、どのテーブルが
-- 変わったかを区別する必要がない)。moderation_thresholds/moderation_whitelistはguild_idが
-- 複合主キーの一部だが、moderation_ngwordsはidが単独主キーでguild_idはPK外のカラムのため、
-- UPDATEでguild_id自体が変わり得る。0013(log_channel_settings)の前例と同様、UPDATE時に
-- OLDとNEWのguild_idが異なる場合は両方通知する(片方だけ通知すると旧guild側のキャッシュが
-- TTL満了まで残る、codexレビュー指摘)。
CREATE FUNCTION notify_moderation_config_changed() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify(
    'moderation_config_changed',
    json_build_object('guildId', COALESCE(NEW.guild_id, OLD.guild_id))::text
  );
  IF TG_OP = 'UPDATE' AND NEW.guild_id IS DISTINCT FROM OLD.guild_id THEN
    PERFORM pg_notify(
      'moderation_config_changed',
      json_build_object('guildId', OLD.guild_id)::text
    );
  END IF;
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
