import { describe, expect, test } from "bun:test";
import type { HourlyDelta } from "../application/index.js";
import { MessageCounter } from "./message-counter.js";

const t = (iso: string) => new Date(iso);

describe("MessageCounter", () => {
  test("同じ(guild,user,hour)をまとめてflushする", async () => {
    const written: HourlyDelta[] = [];
    const counter = new MessageCounter(async (d) => {
      written.push(...d);
    });
    counter.record("g", "u", t("2026-09-29T10:01:00Z"));
    counter.record("g", "u", t("2026-09-29T10:59:00Z"));
    counter.record("g", "u", t("2026-09-29T11:00:00Z"));
    await counter.flush();
    expect(written).toEqual([
      { guildId: "g", userId: "u", hour: t("2026-09-29T10:00:00Z"), messageCount: 2, voiceSeconds: 0, lastMessageAt: t("2026-09-29T10:59:00Z") },
      { guildId: "g", userId: "u", hour: t("2026-09-29T11:00:00Z"), messageCount: 1, voiceSeconds: 0, lastMessageAt: t("2026-09-29T11:00:00Z") },
    ]);
  });

  test("書き込み失敗時はカウントを持ち越し、次回flushで書く", async () => {
    let fail = true;
    const written: HourlyDelta[] = [];
    const counter = new MessageCounter(async (d) => {
      if (fail) throw new Error("db down");
      written.push(...d);
    });
    counter.record("g", "u", t("2026-09-29T10:00:00Z"));
    await expect(counter.flush()).rejects.toThrow("db down");
    counter.record("g", "u", t("2026-09-29T10:05:00Z"));
    fail = false;
    await counter.flush();
    expect(written).toEqual([
      { guildId: "g", userId: "u", hour: t("2026-09-29T10:00:00Z"), messageCount: 2, voiceSeconds: 0, lastMessageAt: t("2026-09-29T10:05:00Z") },
    ]);
  });

  test("空ならwriteを呼ばない", async () => {
    let called = false;
    const counter = new MessageCounter(async () => {
      called = true;
    });
    await counter.flush();
    expect(called).toBe(false);
  });
});
