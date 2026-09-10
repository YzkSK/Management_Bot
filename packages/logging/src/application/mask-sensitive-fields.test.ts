import { describe, expect, test } from "bun:test";
import type { LogEntry } from "../domain/index.js";
import { maskSensitiveFields } from "./list-log-entries.js";

describe("maskSensitiveFields", () => {
  test("通常のログ閲覧では現在のメッセージ本文を残し、編集前本文だけを隠す", () => {
    const entry: LogEntry = {
      category: "message",
      guildId: "g1",
      createdAt: "2026-09-10T00:00:00.000Z",
      channelId: "c1",
      authorId: "u1",
      action: "update",
      content: "現在の本文",
      previousContent: "編集前の本文",
    };

    const masked = maskSensitiveFields(entry);

    expect((masked as { content?: string }).content).toBe("現在の本文");
    expect((masked as { previousContent?: string }).previousContent).toBeUndefined();
  });

  test("通常のログ閲覧ではスレッドの本文を残す", () => {
    const entry: LogEntry = {
      category: "thread",
      guildId: "g1",
      createdAt: "2026-09-10T00:00:00.000Z",
      threadId: "t1",
      channelId: "c1",
      action: "create",
      content: "スレッドの本文",
    };

    const masked = maskSensitiveFields(entry);

    expect((masked as { content?: string }).content).toBe("スレッドの本文");
  });
});
