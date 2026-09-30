-- issue #527: 削除したcapability(MANAGE_ACTIVITY_SETTINGS=1<<1, VIEW_MODERATION=1<<7, MANAGE_GUILD_SETTINGS=1<<10)の
-- ビットを既存grantから落とす。残すと未知ビットを含むgrantとして行ごと無視され、他の権限まで失われるため。
UPDATE "capability_grants" SET "capabilities" = "capabilities" & ~1154 WHERE "capabilities" & 1154 <> 0;--> statement-breakpoint
DELETE FROM "capability_grants" WHERE "capabilities" = 0;
--> statement-breakpoint
-- 管理・生データ閲覧権限は対応する閲覧権限を前提とする(hasCapabilityPrerequisites)ため、欠けている閲覧権限を補う。
-- VIEW_LOGS_RAW(1<<3)・MANAGE_LOGGING_SETTINGS(1<<4) → VIEW_LOGS(1<<2)
UPDATE "capability_grants" SET "capabilities" = "capabilities" | 4 WHERE "capabilities" & 24 <> 0;--> statement-breakpoint
-- MANAGE_TEMP_VOICE(1<<6) → VIEW_TEMP_VOICE(1<<5)
UPDATE "capability_grants" SET "capabilities" = "capabilities" | 32 WHERE "capabilities" & 64 <> 0;
