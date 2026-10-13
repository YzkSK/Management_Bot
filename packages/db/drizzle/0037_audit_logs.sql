CREATE TABLE "audit_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"kind" text NOT NULL,
	"actor_id" text,
	"actor_name" text NOT NULL,
	"feature" text NOT NULL,
	"action" text NOT NULL,
	"outcome" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_logs_kind_check" CHECK ("audit_logs"."kind" IN ('action', 'access')),
	CONSTRAINT "audit_logs_outcome_check" CHECK ("audit_logs"."outcome" IN ('pending', 'success', 'failure', 'denied'))
);
--> statement-breakpoint
CREATE INDEX "audit_logs_guild_created_at_idx" ON "audit_logs" USING btree ("guild_id","created_at" DESC NULLS LAST);
--> statement-breakpoint
-- 追記専用の保証(issue #618)。UPDATEは「pending→確定のoutcome更新」のみ(beforeはNULL→値の補完も可)、
-- DELETEは保存期間切れ(action 1年 / access 90日。audit-log.tsのpurgeExpiredAuditLogsと同じ値)の行のみ許可する。
CREATE FUNCTION audit_logs_guard_update() RETURNS trigger AS $$
BEGIN
  IF OLD.outcome = 'pending'
    AND NEW.outcome <> 'pending'
    AND NEW.id = OLD.id
    AND NEW.guild_id = OLD.guild_id
    AND NEW.kind = OLD.kind
    AND NEW.actor_id IS NOT DISTINCT FROM OLD.actor_id
    AND NEW.actor_name = OLD.actor_name
    AND NEW.feature = OLD.feature
    AND NEW.action = OLD.action
    AND (OLD.before IS NULL OR NEW.before IS NOT DISTINCT FROM OLD.before)
    AND NEW.after IS NOT DISTINCT FROM OLD.after
    AND NEW.created_at = OLD.created_at
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'audit_logs is append-only: this update is not allowed';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_logs_guard_update
BEFORE UPDATE ON audit_logs
FOR EACH ROW EXECUTE FUNCTION audit_logs_guard_update();
--> statement-breakpoint
CREATE FUNCTION audit_logs_guard_delete() RETURNS trigger AS $$
BEGIN
  IF (OLD.kind = 'action' AND OLD.created_at < now() - interval '1 year')
    OR (OLD.kind = 'access' AND OLD.created_at < now() - interval '90 days')
  THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'audit_logs is append-only: only rows past retention can be deleted';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_logs_guard_delete
BEFORE DELETE ON audit_logs
FOR EACH ROW EXECUTE FUNCTION audit_logs_guard_delete();
