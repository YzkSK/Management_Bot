import { describe, expect, test } from "bun:test";
import { summarizeLogEntry } from "./log-entry-summary.js";

describe("summarizeLogEntry", () => {
  test("category/createdAt/executorId/actionを取り出し、残りはdetailsに入れる", () => {
    const summary = summarizeLogEntry({
      category: "role",
      createdAt: "2026-09-04T00:00:00.000Z",
      guildId: "g1",
      executorId: "u1",
      channelId: "c1",
      authorId: "a1",
      action: "delete",
    });

    expect(summary).toEqual({
      category: "role",
      createdAt: "2026-09-04T00:00:00.000Z",
      executorId: "u1",
      action: "delete",
      content: null,
      details: { channelId: "c1", authorId: "a1" },
    });
  });

  test("executorId未設定の場合はnullになる", () => {
    const summary = summarizeLogEntry({
      category: "guild",
      createdAt: "2026-09-04T00:00:00.000Z",
      guildId: "g1",
      action: "update",
    });

    expect(summary.executorId).toBeNull();
  });

  test("contentはdetailsに埋めずそのまま取り出す", () => {
    const summary = summarizeLogEntry({
      category: "message",
      createdAt: "2026-09-04T00:00:00.000Z",
      guildId: "g1",
      channelId: "c1",
      authorId: "a1",
      action: "create",
      content: "こんにちは",
    });

    expect(summary.content).toBe("こんにちは");
    expect(summary.details).toEqual({ channelId: "c1", authorId: "a1" });
  });

  test("content未設定の場合はnullになる", () => {
    const summary = summarizeLogEntry({
      category: "message",
      createdAt: "2026-09-04T00:00:00.000Z",
      guildId: "g1",
      action: "delete",
    });

    expect(summary.content).toBeNull();
  });
});
