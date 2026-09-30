-- issue #527: 削除したcapability(MANAGE_ACTIVITY_SETTINGS=1<<1, VIEW_MODERATION=1<<7, MANAGE_GUILD_SETTINGS=1<<10)の
-- ビットを既存grantから落とす。残すと未知ビットを含むgrantとして行ごと無視され、他の権限まで失われるため。
UPDATE "capability_grants" SET "capabilities" = "capabilities" & ~1154 WHERE "capabilities" & 1154 <> 0;--> statement-breakpoint
DELETE FROM "capability_grants" WHERE "capabilities" = 0;
