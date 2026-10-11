import { describe, expect, test } from "bun:test";
import { describeOutcome, tabOfStatus } from "./scheduled-post-view.js";

describe("scheduled-post-view", () => {
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
