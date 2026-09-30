import { describe, expect, test } from "bun:test";
import type { InfraLogEntry } from "@management-bot/shared";
import { describeItem, filterLogs } from "./status-labels.js";

const entry = (level: InfraLogEntry["level"], msg: string): InfraLogEntry => ({
  at: "2026-09-30T00:00:00.000Z",
  service: "bot",
  level,
  scope: "bot",
  msg,
});

describe("filterLogs", () => {
  const entries = [entry("INFO", "ready"), entry("WARN", "Heartbeat delayed"), entry("ERROR", "post failed")];
  test("レベルで絞り込む", () => {
    expect(filterLogs(entries, "all", "").length).toBe(3);
    expect(filterLogs(entries, "warn", "").map((e) => e.level)).toEqual(["WARN", "ERROR"]);
    expect(filterLogs(entries, "error", "").map((e) => e.level)).toEqual(["ERROR"]);
  });
  test("メッセージを大文字小文字を区別せず検索する", () => {
    expect(filterLogs(entries, "all", " heartbeat ").map((e) => e.msg)).toEqual(["Heartbeat delayed"]);
  });
});

describe("describeItem", () => {
  test("値が取れない基盤は接続できない旨を出す", () => {
    expect(describeItem({ key: "postgres", state: "down", lastRunAt: null, values: {} })).toBe("接続できません");
    expect(describeItem({ key: "bot", state: "down", lastRunAt: null, values: {} })).toBe("Discordに接続していません");
  });
  test("数値を補足文にする", () => {
    expect(describeItem({ key: "bot", state: "ok", lastRunAt: null, values: { pingMs: 42, guilds: 3 } })).toBe(
      "Gateway ping 42ms ・ 参加サーバー 3",
    );
    expect(describeItem({ key: "redis", state: "ok", lastRunAt: null, values: { usedMemoryBytes: 1572864 } })).toBe("メモリ 1.5MB");
    expect(describeItem({ key: "logging", state: "warn", lastRunAt: null, values: { pendingEvents: 150 } })).toBe(
      "未処理イベント 150件(処理が遅れています)",
    );
  });
  test("未実行の定期ジョブは未実行と出す", () => {
    expect(describeItem({ key: "backup", state: "ok", lastRunAt: null, values: {} })).toBe("最終実行 未実行");
  });
});
