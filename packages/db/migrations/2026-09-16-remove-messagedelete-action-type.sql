-- Issue #321: ModerationActionTypeからmessageDeleteを廃止する。
-- メッセージ削除はwarn以降の全アクションに付随する処理として実行されるようになったため、
-- 独立したアクション種別としては扱わなくなった。
--
-- log_entries.payload(jsonb)のmoderationCaseカテゴリに保存された既存のactionType: "messageDelete"は
-- 新しいMODERATION_ACTION_TYPES(warn/timeout/kick/ban/unban)のzodバリデーションを通らなくなるため、
-- warnに書き換える(実際には削除だった段階を警告として表示するトレードオフを許容する)。
--
-- 実行前に対象件数を確認すること:
--   SELECT count(*) FROM log_entries
--   WHERE category = 'moderationCase' AND payload ->> 'actionType' = 'messageDelete';
--
-- マージ前に本番DBで1度だけ実行する。

UPDATE log_entries
SET payload = jsonb_set(payload, '{actionType}', '"warn"')
WHERE category = 'moderationCase'
  AND payload ->> 'actionType' = 'messageDelete';
