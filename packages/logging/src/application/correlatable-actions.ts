import type { LogEntry } from "../domain/index.js";

/**
 * 監査ログ相関(correlate-audit-log-entry.ts)によって後からexecutorIdが追記され得る
 * (category, action)の一覧。CORRELATION_RULESおよび同ファイル内の特殊ケース
 * (MemberRoleUpdate→role/memberAdd,memberRemove、MessageDelete→message/delete、
 * MemberDisconnect/MemberMove→voice/leave,move、MemberUpdate voiceState→voice/update)
 * と手動で同期させる。writeLogEntryが送信前に相関完了を待つべきかどうかの判定に使う。
 * 新しいCORRELATION_RULESエントリを追加した場合はここにも追記すること
 * (correlatable-actions.test.tsでCORRELATION_RULESとの整合をチェックしている)。
 */
const CORRELATABLE_ACTIONS: { [C in LogEntry["category"]]?: readonly string[] } = {
  guild: ["update"],
  channel: ["create", "update", "delete"],
  // leaveはMemberKick相当の監査ログが届くとkickへrewriteAction(actionの書き換え)され得るため対象に含む。
  member: ["leave", "kick", "ban", "unban", "nicknameChange", "timeout", "timeoutRemove"],
  role: ["create", "update", "delete", "memberAdd", "memberRemove"],
  thread: ["create", "update", "archive", "unarchive", "delete"],
  invite: ["create", "delete"],
  emoji: ["create", "update", "delete"],
  sticker: ["create", "update", "delete"],
  autoMod: ["ruleCreate", "ruleUpdate", "ruleDelete"],
  scheduledEvent: ["create", "update", "delete", "start", "complete", "cancel"],
  stage: ["start", "update", "end"],
  message: ["delete"],
  voice: ["leave", "move", "update"],
};

/**
 * entryが監査ログ相関の対象(後からexecutorIdが追記されうる)かどうかを判定する。
 * 対象ならwriteLogEntryは送信前に少し待ち、相関が間に合っていればexecutorId付きで送信する。
 */
export function isCorrelatable(entry: LogEntry): boolean {
  const actions = CORRELATABLE_ACTIONS[entry.category];
  return actions !== undefined && "action" in entry && actions.includes(entry.action);
}
