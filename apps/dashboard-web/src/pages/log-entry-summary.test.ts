import { describe, expect, test } from "bun:test";
import { summarizeLogEntry } from "./log-entry-summary.js";
import type { LogEntry } from "@management-bot/logging";

describe("summarizeLogEntry", () => {
  test("executorIdがあればexecutorIdをsubjectIdとして使う", () => {
    const entry = {
      category: "role",
      createdAt: "2026-09-04T00:00:00.000Z",
      guildId: "g1",
      executorId: "u1",
      channelId: "c1",
      authorId: "a1",
      action: "delete",
    } as unknown as LogEntry;

    const summary = summarizeLogEntry(entry);

    expect(summary).toEqual({
      category: "role",
      createdAt: "2026-09-04T00:00:00.000Z",
      subjectId: "u1",
      action: "delete",
      content: null,
      details: { channelId: "c1", authorId: "a1" },
    });
  });

  test("executorId未設定でカテゴリ固有の主体IDがあればそれをsubjectIdにする", () => {
    const entry = {
      category: "message",
      createdAt: "2026-09-04T00:00:00.000Z",
      guildId: "g1",
      channelId: "c1",
      authorId: "a1",
      action: "delete",
    } as unknown as LogEntry;

    const summary = summarizeLogEntry(entry);

    expect(summary.subjectId).toBe("a1");
    // authorIdはsubjectIdとして採用されたのでdetailsには残らない
    expect(summary.details).toEqual({ channelId: "c1" });
  });

  test("executorIdも主体IDもない場合はnullになる", () => {
    const entry = {
      category: "guild",
      createdAt: "2026-09-04T00:00:00.000Z",
      guildId: "g1",
      action: "update",
    } as unknown as LogEntry;

    expect(summarizeLogEntry(entry).subjectId).toBeNull();
  });

  test("contentはdetailsに埋めずそのまま取り出す", () => {
    const entry = {
      category: "message",
      createdAt: "2026-09-04T00:00:00.000Z",
      guildId: "g1",
      channelId: "c1",
      authorId: "a1",
      action: "create",
      content: "こんにちは",
    } as unknown as LogEntry;

    const summary = summarizeLogEntry(entry);
    expect(summary.content).toBe("こんにちは");
    expect(summary.details).toEqual({ channelId: "c1" });
  });

  test("content未設定の場合はnullになる", () => {
    const entry = {
      category: "message",
      createdAt: "2026-09-04T00:00:00.000Z",
      guildId: "g1",
      channelId: "c1",
      authorId: "a1",
      action: "delete",
    } as unknown as LogEntry;

    expect(summarizeLogEntry(entry).content).toBeNull();
  });
});
