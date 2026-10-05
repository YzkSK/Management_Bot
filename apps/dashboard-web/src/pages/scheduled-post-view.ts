import { SCHEDULED_POST_FAILURE_LABELS } from "@management-bot/shared";

export type ScheduledPostTab = "pending" | "posted" | "failed" | "cancelled";

export const SCHEDULED_POST_TABS: readonly { value: ScheduledPostTab; label: string }[] = [
  { value: "pending", label: "投稿待ち" },
  { value: "posted", label: "投稿済み" },
  { value: "failed", label: "失敗" },
  { value: "cancelled", label: "取り消し" },
];

/** 投稿処理中(posting)は「投稿待ち」タブに含める。 */
export function tabOfStatus(status: string): ScheduledPostTab | null {
  switch (status) {
    case "pending":
    case "posting":
      return "pending";
    case "posted":
    case "failed":
    case "cancelled":
      return status;
    default:
      return null;
  }
}

const FAILURE_LABELS: Record<string, string> = SCHEDULED_POST_FAILURE_LABELS;

/** 一覧の「状態」列に出す補足(失敗原因・取り消した人)。 */
export function describeOutcome(row: { status: string; failureReason: string | null; cancelledBy: string | null }): string {
  if (row.status === "posting") return "投稿処理中";
  if (row.status === "failed") return (row.failureReason && FAILURE_LABELS[row.failureReason]) || "原因不明";
  if (row.status === "cancelled") return row.cancelledBy === "admin" ? "管理者が取り消し" : "予約者が取り消し";
  return "";
}
