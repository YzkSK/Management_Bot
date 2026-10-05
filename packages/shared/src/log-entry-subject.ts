import { isBulkDeleteLogEntry, type LogEntry } from "./log-entry.js";

/**
 * カテゴリごとに異なる形のLogEntryから「誰の行動/誰に対する行動か」を表す
 * 単一のユーザーIDを取り出す。executorId(監査ログ相関で事後的に埋まる実行者)は
 * ここでは見ない(呼び出し側で優先度を決める)。
 * moderationCaseはtargetUserId(処分対象)を返す。実行者を見たい場合はmoderatorIdを別途参照すること。
 */
export function getLogEntrySubjectId(entry: LogEntry): string | undefined {
  switch (entry.category) {
    case "message":
      if (isBulkDeleteLogEntry(entry)) return undefined;
      // pin/unpinは「投稿者」ではなく「ピン留め操作をした人」が主語であるべきだが、
      // authorIdは投稿者(ピン留めされたメッセージの著者)であり実行者ではない。
      // executorId(監査ログ相関)は現状pinを相関対象にしていないため常に未設定で、
      // ここでauthorIdを返すとformatLogMessageが誤って投稿者を実行者として表示してしまう
      // (issue報告: 実際にピン留めした人ではなく投稿者名が「〜がピン留めしました」に出る)。
      if (entry.action === "pin" || entry.action === "unpin") return undefined;
      return entry.authorId;
    case "reaction":
      return entry.userId;
    case "member":
      return entry.userId;
    case "role":
      return entry.userId;
    case "thread":
      return entry.userId;
    case "autoMod":
      return entry.userId;
    case "voice":
      return entry.userId;
    case "moderationCase":
      return entry.targetUserId;
    case "scheduledPost":
      return entry.authorId;
    case "tempVoice":
      switch (entry.action) {
        case "created":
        case "deleted":
          return entry.ownerId;
        case "memberPermissionChanged":
          return entry.targetId;
        case "renamed":
        case "permissionChanged":
        case "userLimitChanged":
        case "bitrateChanged":
        case "ownerTransferred":
          return undefined;
      }
      return undefined;
    case "channel":
    case "guild":
    case "invite":
    case "emoji":
    case "sticker":
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
      if (isBulkDeleteLogEntry(entry)) return undefined;
      if (entry.action === "pin" || entry.action === "unpin") return undefined;
      return "authorId";
    case "reaction":
      return "userId";
    case "member":
      return "userId";
    case "role":
      return entry.userId !== undefined ? "userId" : undefined;
    case "thread":
      return entry.userId !== undefined ? "userId" : undefined;
    case "autoMod":
      return "userId";
    case "voice":
      return "userId";
    case "moderationCase":
      return "targetUserId";
    case "scheduledPost":
      return "authorId";
    case "tempVoice":
      switch (entry.action) {
        case "created":
        case "deleted":
          return "ownerId";
        case "memberPermissionChanged":
          return "targetId";
        case "renamed":
        case "permissionChanged":
        case "userLimitChanged":
        case "bitrateChanged":
        case "ownerTransferred":
          return undefined;
      }
      return undefined;
    case "channel":
    case "guild":
    case "invite":
    case "emoji":
    case "sticker":
    case "integration":
    case "poll":
    case "scheduledEvent":
    case "stage":
    case "auditLogCorrelation":
      return undefined;
  }
}
