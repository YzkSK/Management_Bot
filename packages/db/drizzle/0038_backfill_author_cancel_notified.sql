-- 本人取り消しもBotの後処理回収(cancel_notified_at IS NULL)の対象になったため、既存の本人取り消しを処理済みにして、デプロイ直後に過去のログが再発行されないようにする。
UPDATE "scheduled_posts" SET "cancel_notified_at" = COALESCE("finished_at", now()) WHERE "status" = 'cancelled' AND "cancelled_by" = 'author' AND "cancel_notified_at" IS NULL;
