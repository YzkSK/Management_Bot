import { describe, expect, test } from "bun:test";
import { countByTab, describeOutcome, describeRelativeTime, tabOfStatus } from "./scheduled-post-view.js";

describe("scheduled-post-view", () => {
  test("countByTabはタブごとの件数を数え、postingは投稿待ちに含め、未知の状態は無視する", () => {
    const rows = [{ status: "pending" }, { status: "posting" }, { status: "posted" }, { status: "cancelled" }, { status: "x" }];
    expect(countByTab(rows)).toEqual({ pending: 2, posted: 1, failed: 0, cancelled: 1 });
  });

  test("相対時間は未来を「あと」、過去を「前」で表し、投稿済みは「に投稿」を付ける", () => {
    const now = new Date(2026, 9, 12, 12, 0);
    const at = (ms: number) => new Date(now.getTime() + ms);
    const H = 3_600_000;
    expect(describeRelativeTime(at(18 * H), "pending", now)).toEqual({ text: "あと18時間", upcoming: true });
    expect(describeRelativeTime(at(30 * 60_000), "pending", now).text).toBe("あと30分");
    expect(describeRelativeTime(at(72 * H), "pending", now).text).toBe("あと3日");
    expect(describeRelativeTime(at(-1 * H), "pending", now)).toEqual({ text: "まもなく投稿", upcoming: true });
    expect(describeRelativeTime(at(-48 * H), "posted", now)).toEqual({ text: "2日前に投稿", upcoming: false });
    expect(describeRelativeTime(at(-72 * H), "failed", now).text).toBe("3日前");
    expect(describeRelativeTime(at(-5 * H), "cancelled", now).text).toBe("5時間前");
  });

  test("postingは投稿待ちタブに含まれ、未知の状態はどのタブにも属さない", () => {
    expect(tabOfStatus("pending")).toBe("pending");
    expect(tabOfStatus("posting")).toBe("pending");
    expect(tabOfStatus("failed")).toBe("failed");
    expect(tabOfStatus("unknown")).toBeNull();
  });

  test("失敗原因・取り消した人を文言にする", () => {
    expect(describeOutcome({ status: "failed", failureReason: "no_role", cancelledBy: null })).toContain("ロール");
    expect(describeOutcome({ status: "failed", failureReason: null, cancelledBy: null })).toBe("原因不明");
    expect(describeOutcome({ status: "cancelled", failureReason: null, cancelledBy: "admin" })).toBe("管理者が取り消し");
    expect(describeOutcome({ status: "cancelled", failureReason: null, cancelledBy: "author" })).toBe("予約者が取り消し");
    expect(describeOutcome({ status: "posted", failureReason: null, cancelledBy: null })).toBe("");
  });
});
