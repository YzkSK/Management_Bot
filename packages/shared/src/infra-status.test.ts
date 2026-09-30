import { afterEach, describe, expect, test } from "bun:test";
import {
  INFRA_LOG_STREAM,
  INFRA_STATUS_KEY,
  formatConsoleArgs,
  infraHeartbeatSchema,
  infraLogEntrySchema,
  startInfraReporter,
  type InfraReporter,
} from "./infra-status.js";

function fakeRedis() {
  const xadds: string[][] = [];
  const hsets: [string, string, string][] = [];
  return {
    xadds,
    hsets,
    xadd: async (key: string, ...args: string[]) => void xadds.push([key, ...args]),
    hset: async (key: string, field: string, value: string) => void hsets.push([key, field, value]),
  };
}

let reporter: InfraReporter | undefined;
afterEach(() => reporter?.stop());

describe("startInfraReporter", () => {
  test("console出力を上限付きStreamへ複製し、元の出力も維持する", () => {
    const redis = fakeRedis();
    const now = () => new Date("2026-09-30T00:00:00.000Z");
    reporter = startInfraReporter(redis, { name: "backup", service: "worker", now });
    console.warn("disk", { free: 1 });

    const last = redis.xadds.at(-1)!;
    expect(last.slice(0, 5)).toEqual([INFRA_LOG_STREAM, "MAXLEN", "~", "5000", "*"]);
    expect(infraLogEntrySchema.parse(JSON.parse(last[6]!))).toEqual({
      at: "2026-09-30T00:00:00.000Z",
      service: "worker",
      level: "WARN",
      scope: "backup",
      msg: 'disk {"free":1}',
    });
  });

  test("起動時とrecordRun時にハートビートを書き込む", () => {
    const redis = fakeRedis();
    reporter = startInfraReporter(redis, { name: "backup", service: "worker" });
    reporter.recordRun(false);
    const [key, field, value] = redis.hsets.at(-1)!;
    expect([key, field]).toEqual([INFRA_STATUS_KEY, "backup"]);
    expect(infraHeartbeatSchema.parse(JSON.parse(value)).lastOk).toBe(false);
    expect(redis.hsets.length).toBe(2);
  });

  test("stopでconsoleを元に戻す", () => {
    const original = console.info;
    reporter = startInfraReporter(fakeRedis(), { name: "bot", service: "bot" });
    expect(console.info).not.toBe(original);
    reporter.stop();
    expect(console.info).toBe(original);
  });
});

test("formatConsoleArgsはErrorをstackで出す", () => {
  const error = new Error("boom");
  expect(formatConsoleArgs(["failed:", error])).toContain("Error: boom");
});
