-- issue #737: 予約投稿機能(scheduled-post)の削除。Discord公式に同等機能が入ったため。
-- 0040のguild_data_changedトリガー(DROP TABLEで消えるが明示する)。
DROP TRIGGER IF EXISTS scheduled_posts_notify_guild_data_changed ON scheduled_posts;--> statement-breakpoint
DROP TRIGGER IF EXISTS scheduled_post_settings_notify_guild_data_changed ON scheduled_post_settings;--> statement-breakpoint
DROP TABLE IF EXISTS "scheduled_post_settings", "scheduled_posts" CASCADE;--> statement-breakpoint
-- featureマスター行を消す(guild_feature_togglesはON DELETE CASCADE)。
DELETE FROM "features" WHERE "key" = 'scheduled-post';--> statement-breakpoint
-- ログカテゴリscheduledPostの設定・既存ログを消し、CHECK制約から値を外す。
DELETE FROM "log_entries" WHERE "category" = 'scheduledPost';--> statement-breakpoint
DELETE FROM "log_channel_settings" WHERE "category" = 'scheduledPost';--> statement-breakpoint
DELETE FROM "log_retention_settings" WHERE "category" = 'scheduledPost';--> statement-breakpoint
ALTER TABLE "log_channel_settings" DROP CONSTRAINT "log_channel_settings_category_check";--> statement-breakpoint
ALTER TABLE "log_entries" DROP CONSTRAINT "log_entries_category_check";--> statement-breakpoint
ALTER TABLE "log_retention_settings" DROP CONSTRAINT "log_retention_settings_category_check";--> statement-breakpoint
ALTER TABLE "log_channel_settings" ADD CONSTRAINT "log_channel_settings_category_check" CHECK ("log_channel_settings"."category" IN ('message', 'reaction', 'member', 'role', 'channel', 'guild', 'thread', 'invite', 'emoji', 'sticker', 'autoMod', 'integration', 'poll', 'scheduledEvent', 'stage', 'auditLogCorrelation', 'moderationCase', 'voice', 'tempVoice'));--> statement-breakpoint
ALTER TABLE "log_entries" ADD CONSTRAINT "log_entries_category_check" CHECK ("log_entries"."category" IN ('message', 'reaction', 'member', 'role', 'channel', 'guild', 'thread', 'invite', 'emoji', 'sticker', 'autoMod', 'integration', 'poll', 'scheduledEvent', 'stage', 'auditLogCorrelation', 'moderationCase', 'voice', 'tempVoice'));--> statement-breakpoint
ALTER TABLE "log_retention_settings" ADD CONSTRAINT "log_retention_settings_category_check" CHECK ("log_retention_settings"."category" IN ('message', 'reaction', 'member', 'role', 'channel', 'guild', 'thread', 'invite', 'emoji', 'sticker', 'autoMod', 'integration', 'poll', 'scheduledEvent', 'stage', 'auditLogCorrelation', 'moderationCase', 'voice', 'tempVoice'));--> statement-breakpoint
-- 削除したcapability(VIEW_SCHEDULED_POSTS=1<<11, MANAGE_SCHEDULED_POSTS=1<<12 = 6144)のビットを既存grantから落とす
-- (残すと未知ビットを含むgrantとして行ごと無視され、他の権限まで失われるため。0033と同じ扱い)。
UPDATE "capability_grants" SET "capabilities" = "capabilities" & ~6144 WHERE "capabilities" & 6144 <> 0;--> statement-breakpoint
DELETE FROM "capability_grants" WHERE "capabilities" = 0;
