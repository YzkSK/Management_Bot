import { describe, expect, test } from "bun:test";
import type { InfraLogEntry } from "@management-bot/shared";
import { describeItem, filterLogs, formatBytes, formatUptime, toPolylinePoints, usageBarClass } from "./status-labels.js";

describe("リソース表示の整形", () => {
  test("formatBytesは1024進数で単位を付ける", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(20.6 * 1024 ** 3)).toBe("20.6 GB");
  });
  test("formatUptimeは日・時間・分の上位2単位まで", () => {
    expect(formatUptime(((3 * 24 + 4) * 60 + 7) * 60_000)).toBe("3日 4時間");
    expect(formatUptime((4 * 60 + 5) * 60_000)).toBe("4時間 5分");
    expect(formatUptime(5 * 60_000)).toBe("5分");
  });
  test("usageBarClassは80%と90%で色を変える", () => {
    expect(usageBarClass(79.9)).toBe("bg-success");
    expect(usageBarClass(80)).toBe("bg-warning");
    expect(usageBarClass(90)).toBe("bg-destructive");
  });
  test("toPolylinePointsは下端を0として写し、範囲外は丸める", () => {
    expect(toPolylinePoints([0, 50, 200], 100, 100, 10)).toBe("0.0,10.0 50.0,5.0 100.0,0.0");
    expect(toPolylinePoints([50], 100, 100, 10)).toBe("0.0,5.0");
  });
});

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
