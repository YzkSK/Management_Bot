/** 予約投稿(scheduled-post)機能のDB・イベント・ログ・UIで共有する定数。 */

export const SCHEDULED_POST_STATUSES = ["pending", "posting", "posted", "failed", "cancelled"] as const;
export type ScheduledPostStatus = (typeof SCHEDULED_POST_STATUSES)[number];

export const SCHEDULED_POST_FAILURE_REASONS = [
  "author_left",
  "no_permission",
  "no_role",
  "channel_deleted",
  "bot_missing_permission",
  "thread_archived",
  "expired",
  "unknown_result",
  "send_failed",
] as const;
export type ScheduledPostFailureReason = (typeof SCHEDULED_POST_FAILURE_REASONS)[number];

export const SCHEDULED_POST_CANCELLED_BY = ["author", "admin"] as const;
export type ScheduledPostCancelledBy = (typeof SCHEDULED_POST_CANCELLED_BY)[number];

export const SCHEDULED_POST_FAILURE_LABELS: Record<ScheduledPostFailureReason, string> = {
  author_left: "予約者がサーバーを退出していた",
  no_permission: "予約者にチャンネルへの送信権限がなかった",
  no_role: "予約者が「使えるロール」を持っていなかった",
  channel_deleted: "投稿先のチャンネルが存在しない・種別が対象外だった",
  bot_missing_permission: "Botに投稿先への送信権限がなかった",
  thread_archived: "投稿先のスレッドがアーカイブまたはロックされていた",
  expired: "予定時刻から1時間以上経過したため投稿を見送った(時間切れ)",
  unknown_result: "投稿処理の途中でBotが停止し、送信できたか不明(再送していません)",
  send_failed: "Discordへの送信に失敗した",
};

/** 本文の最大文字数(Botが送れる通常メッセージの上限)。 */
export const SCHEDULED_POST_CONTENT_MAX = 2000;
