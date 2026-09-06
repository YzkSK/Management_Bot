import type { LogEntry } from "@management-bot/shared";
import { CATEGORY_LABELS } from "./category-labels.js";
import type { LogEntrySummary } from "./log-entry-summary.js";

interface NameResolvers {
  users: Record<string, string>;
  channels: Record<string, string>;
}

function userName(id: string, names: NameResolvers): string {
  return names.users[id] ?? id;
}

function channelName(id: string, names: NameResolvers): string {
  const name = names.channels[id];
  return name ? `#${name}` : `#${id}`;
}

/** summarizeLogEntryの出力(カテゴリ横断の共通形式)を、一覧カード見出し用の日本語1文に変換する。 */
export function formatLogMessage(entry: LogEntry, summary: LogEntrySummary, names: NameResolvers): string {
  const executorName = summary.subjectId ? userName(summary.subjectId, names) : "不明なユーザー";

  switch (entry.category) {
    case "message": {
      const authorName = userName(entry.authorId, names);
      switch (entry.action) {
        case "create":
          return `${authorName} がメッセージを投稿しました`;
        case "update":
          return `${authorName} がメッセージを編集しました`;
        case "delete":
        case "bulkDelete": {
          const suffix = entry.action === "bulkDelete" ? "複数のメッセージを削除しました" : "メッセージを削除しました";
          return entry.authorId === entry.executorId || entry.executorId === undefined
            ? `${authorName} が自分の${suffix}`
            : `${executorName} が ${authorName} の${suffix}`;
        }
        case "pin":
          return `${executorName} がメッセージをピン留めしました`;
        case "unpin":
          return `${executorName} がメッセージのピン留めを解除しました`;
      }
      break;
    }
    case "voice": {
      const targetName = userName(entry.userId, names);
      switch (entry.action) {
        case "join":
          return `${targetName} が ${channelName(entry.channelId, names)} に参加しました`;
        case "leave":
          return `${targetName} が ${channelName(entry.channelId, names)} から退出しました`;
        case "move":
          return `${targetName} が ${channelName(entry.previousChannelId, names)} から ${channelName(entry.channelId, names)} に移動しました`;
      }
      break;
    }
    case "member": {
      const targetName = userName(entry.userId, names);
      switch (entry.action) {
        case "join":
          return `${targetName} がサーバーに参加しました`;
        case "leave":
          return `${targetName} がサーバーから退出しました`;
        case "ban":
          return `${executorName} が ${targetName} をBANしました`;
        case "unban":
          return `${executorName} が ${targetName} のBANを解除しました`;
        case "kick":
          return `${executorName} が ${targetName} をキックしました`;
        case "timeout":
          return `${executorName} が ${targetName} をタイムアウトしました`;
        case "timeoutRemove":
          return `${executorName} が ${targetName} のタイムアウトを解除しました`;
        case "nicknameChange":
          return `${executorName} が ${targetName} のニックネームを変更しました`;
      }
      break;
    }
    case "role": {
      switch (entry.action) {
        case "create":
          return `${executorName} がロールを作成しました`;
        case "update":
          return `${executorName} がロールを更新しました`;
        case "delete":
          return `${executorName} がロールを削除しました`;
        case "memberAdd":
          return entry.userId
            ? `${executorName} が ${userName(entry.userId, names)} にロールを付与しました`
            : `${executorName} がロールを付与しました`;
        case "memberRemove":
          return entry.userId
            ? `${executorName} が ${userName(entry.userId, names)} のロールを剥奪しました`
            : `${executorName} がロールを剥奪しました`;
      }
      break;
    }
    case "channel": {
      const target = channelName(entry.channelId, names);
      switch (entry.action) {
        case "create":
          return `${executorName} が ${target} を作成しました`;
        case "update":
          return `${executorName} が ${target} を更新しました`;
        case "delete":
          return `${executorName} が ${target} を削除しました`;
      }
      break;
    }
    case "guild":
      return "サーバー設定が更新されました";
    case "moderationCase": {
      const targetName = userName(entry.targetUserId, names);
      const moderatorName = userName(entry.moderatorId, names);
      switch (entry.action) {
        case "create":
          return `${moderatorName} が ${targetName} にモデレーション処分を行いました`;
        case "update":
          return `${moderatorName} が ${targetName} への処分を更新しました`;
        case "resolve":
          return `${moderatorName} が ${targetName} への処分を解決しました`;
      }
      break;
    }
  }

  return `${CATEGORY_LABELS[entry.category]}: ${summary.action ?? "更新"}`;
}
