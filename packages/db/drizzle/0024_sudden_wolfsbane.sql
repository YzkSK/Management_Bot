DELETE FROM "moderation_escalation_state" WHERE "violation_type" = 'new_account_guard';--> statement-breakpoint
DELETE FROM "moderation_thresholds" WHERE "violation_type" = 'new_account_guard';--> statement-breakpoint
ALTER TABLE "moderation_escalation_state" DROP CONSTRAINT "moderation_escalation_state_violation_type_check";--> statement-breakpoint
ALTER TABLE "moderation_thresholds" DROP CONSTRAINT "moderation_thresholds_violation_type_check";--> statement-breakpoint
ALTER TABLE "moderation_escalation_state" ADD CONSTRAINT "moderation_escalation_state_violation_type_check" CHECK ("moderation_escalation_state"."violation_type" IN ('flood', 'duplicate_content', 'ngword', 'mention_spam', 'invite_link', 'link_spam'));--> statement-breakpoint
ALTER TABLE "moderation_thresholds" ADD CONSTRAINT "moderation_thresholds_violation_type_check" CHECK ("moderation_thresholds"."violation_type" IN ('flood', 'duplicate_content', 'ngword', 'mention_spam', 'invite_link', 'link_spam', 'raid'));
