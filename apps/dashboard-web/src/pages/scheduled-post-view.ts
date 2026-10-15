import { IconAlertCircle, IconCheck, IconClock, IconX, type TablerIcon } from "@tabler/icons-react";
import { SCHEDULED_POST_FAILURE_LABELS } from "@management-bot/shared";

export type ScheduledPostTab = "pending" | "posted" | "failed" | "cancelled";

export const SCHEDULED_POST_TABS: readonly { value: ScheduledPostTab; label: string; icon: TablerIcon }[] = [
  { value: "pending", label: "投稿待ち", icon: IconClock },
  { value: "posted", label: "投稿済み", icon: IconCheck },
  { value: "failed", label: "失敗", icon: IconAlertCircle },
  { value: "cancelled", label: "取り消し", icon: IconX },
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

/** タブごとの件数。どのタブにも属さない状態は数えない。 */
export function countByTab(rows: readonly { status: string }[]): Record<ScheduledPostTab, number> {
  const counts: Record<ScheduledPostTab, number> = { pending: 0, posted: 0, failed: 0, cancelled: 0 };
  for (const row of rows) {
    const tab = tabOfStatus(row.status);
    if (tab) counts[tab] += 1;
  }
  return counts;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * 予約日時までの相対時間。未来は「あと18時間」(強調対象)、過去は「2日前」(投稿済みは「2日前に投稿」)。
 * 投稿待ちで予約時刻を過ぎている間は「まもなく投稿」。
 */
export function describeRelativeTime(
  scheduledAt: string | Date,
  status: string,
  now: Date = new Date(),
): { text: string; upcoming: boolean } {
  const diff = new Date(scheduledAt).getTime() - now.getTime();
  if (diff > 0) {
    if (diff < HOUR_MS) return { text: `あと${Math.max(1, Math.ceil(diff / MINUTE_MS))}分`, upcoming: true };
    if (diff < 2 * DAY_MS) return { text: `あと${Math.floor(diff / HOUR_MS)}時間`, upcoming: true };
    return { text: `あと${Math.floor(diff / DAY_MS)}日`, upcoming: true };
  }
  if (tabOfStatus(status) === "pending") return { text: "まもなく投稿", upcoming: true };
  const past = -diff;
  const ago =
    past < HOUR_MS
      ? `${Math.max(1, Math.floor(past / MINUTE_MS))}分前`
      : past < DAY_MS
        ? `${Math.floor(past / HOUR_MS)}時間前`
        : `${Math.floor(past / DAY_MS)}日前`;
  return { text: status === "posted" ? `${ago}に投稿` : ago, upcoming: false };
}

const FAILURE_LABELS: Record<string, string> = SCHEDULED_POST_FAILURE_LABELS;

/** 一覧の「状態」列に出す補足(失敗原因・取り消した人)。 */
export function describeOutcome(row: { status: string; failureReason: string | null; cancelledBy: string | null }): string {
  if (row.status === "posting") return "投稿処理中";
  if (row.status === "failed") return (row.failureReason && FAILURE_LABELS[row.failureReason]) || "原因不明";
  if (row.status === "cancelled") return row.cancelledBy === "admin" ? "管理者が取り消し" : "予約者が取り消し";
  return "";
}
