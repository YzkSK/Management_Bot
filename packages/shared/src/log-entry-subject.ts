import type { LogEntry } from "./log-entry.js";

/**
 * カテゴリごとに異なる形のLogEntryから「誰の行動/誰に対する行動か」を表す
 * 単一のユーザーIDを取り出す。executorId(監査ログ相関で事後的に埋まる実行者)は
 * ここでは見ない(呼び出し側で優先度を決める)。
 * moderationCaseはtargetUserId(処分対象)を返す。実行者を見たい場合はmoderatorIdを別途参照すること。
 */
export function getLogEntrySubjectId(entry: LogEntry): string | undefined {
  switch (entry.category) {
    case "message":
      return entry.authorId;
    case "member":
      return entry.userId;
    case "role":
      return entry.userId;
    case "autoMod":
      return entry.userId;
    case "voice":
      return entry.userId;
    case "moderationCase":
      return entry.targetUserId;
    case "channel":
    case "guild":
    case "thread":
    case "invite":
    case "emoji":
    case "integration":
    case "poll":
    case "scheduledEvent":
    case "stage":
    case "auditLogCorrelation":
      return undefined;
  }
}

/**
 * カテゴリごとに`getLogEntrySubjectId`が読むフィールド名。detailsからの重複除外にのみ使う。
 * getLogEntrySubjectIdのswitchと必ず同期させること(同じcategoryは同じフィールド名を返す)。
 */
export function getLogEntrySubjectField(entry: LogEntry): string | undefined {
  switch (entry.category) {
    case "message":
      return "authorId";
    case "member":
      return "userId";
    case "role":
      return entry.userId !== undefined ? "userId" : undefined;
    case "autoMod":
      return "userId";
    case "voice":
      return "userId";
    case "moderationCase":
      return "targetUserId";
    case "channel":
    case "guild":
    case "thread":
    case "invite":
    case "emoji":
    case "integration":
    case "poll":
    case "scheduledEvent":
    case "stage":
    case "auditLogCorrelation":
      return undefined;
  }
}
