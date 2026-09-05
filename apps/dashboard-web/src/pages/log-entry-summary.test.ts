import { describe, expect, test } from "bun:test";
import { summarizeLogEntry } from "./log-entry-summary.js";
import type { LogEntry } from "@management-bot/shared";

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
      previousContent: null,
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

  test("executorIdとカテゴリ固有主体IDの値が偶然一致してもdetailsからはフィールド名で判定して除外する(値ではなくキーで比較)", () => {
    // roleのmemberAdd: subjectIdはuserId由来だが、自己付与(executorId===userId)だとexecutorIdが優先される。
    // このときuserIdはsubjectIdと値が同じでも、フィールドとしては別物なのでdetailsに残るべき。
    const entry = {
      category: "role",
      createdAt: "2026-09-04T00:00:00.000Z",
      guildId: "g1",
      executorId: "u1",
      roleId: "r1",
      userId: "u1",
      action: "memberAdd",
    } as unknown as LogEntry;

    const summary = summarizeLogEntry(entry);

    expect(summary.subjectId).toBe("u1");
    expect(summary.details).toEqual({ roleId: "r1", userId: "u1" });
  });

  test("previousContentはdetailsに埋めずそのまま取り出す(編集ログ)", () => {
    const entry = {
      category: "message",
      createdAt: "2026-09-04T00:00:00.000Z",
      guildId: "g1",
      channelId: "c1",
      authorId: "a1",
      action: "update",
      content: "編集後",
      previousContent: "編集前",
    } as unknown as LogEntry;

    const summary = summarizeLogEntry(entry);
    expect(summary.content).toBe("編集後");
    expect(summary.previousContent).toBe("編集前");
    expect(summary.details).toEqual({ channelId: "c1" });
  });

  test("previousContent未設定(移行前の既存ログ等)の場合はnullになる", () => {
    const entry = {
      category: "message",
      createdAt: "2026-09-04T00:00:00.000Z",
      guildId: "g1",
      channelId: "c1",
      authorId: "a1",
      action: "update",
      content: "編集後",
    } as unknown as LogEntry;

    expect(summarizeLogEntry(entry).previousContent).toBeNull();
  });

  test("executorIdとカテゴリ固有主体IDの両方がある場合はexecutorIdが優先される", () => {
    const entry = {
      category: "message",
      createdAt: "2026-09-04T00:00:00.000Z",
      guildId: "g1",
      channelId: "c1",
      authorId: "a1",
      executorId: "mod1",
      action: "delete",
    } as unknown as LogEntry;

    const summary = summarizeLogEntry(entry);

    expect(summary.subjectId).toBe("mod1");
  });
});
