-- log_entriesへの新規INSERT時に、Dashboardのログ一覧WebSocketへ通知するためのpg_notify。
-- payloadはguildId/categoryのみを含む小さいJSON(本文はDashboard側でtRPC経由で別途取得する)。
CREATE FUNCTION notify_log_entry_inserted() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify(
    'log_entry_inserted',
    json_build_object('guildId', NEW.guild_id, 'category', NEW.category)::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER log_entries_notify_insert
AFTER INSERT ON log_entries
FOR EACH ROW EXECUTE FUNCTION notify_log_entry_inserted();
