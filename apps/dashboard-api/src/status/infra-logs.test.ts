import { describe, expect, test } from "bun:test";
import { parseLogStream, parsePostgresLine, parseRedisLine, toInfraLogEntry } from "./infra-logs.js";

describe("parsePostgresLine", () => {
  const jsonLine = (severity: string, message: string) =>
    JSON.stringify({ timestamp: "2026-09-30 10:00:00.123 UTC", pid: 57, error_severity: severity, message });

  test("jsonlogの行からレベルと本文を取り出す", () => {
    expect(parsePostgresLine(jsonLine("WARNING", "out of shared memory"))).toEqual({
      level: "WARN",
      scope: "postgres",
      msg: "out of shared memory",
    });
    expect(parsePostgresLine(jsonLine("FATAL", "password authentication failed")).level).toBe("ERROR");
    expect(parsePostgresLine(jsonLine("LOG", "checkpoint complete")).level).toBe("LOG");
  });
  test("本文の改行は1エントリ内に留まり、偽のログ行にならない(#568)", () => {
    const forged = 'invalid input "x\n2026-09-30 10:00:00.123 UTC [1] FATAL:  fake"';
    expect(parsePostgresLine(jsonLine("ERROR", forged))).toEqual({ level: "ERROR", scope: "postgres", msg: forged });
  });
  test("JSONとして解釈できない行はそのままLOGにする", () => {
    expect(parsePostgresLine("2026-09-30 10:00:00.123 UTC [57] FATAL:  fake")).toEqual({
      level: "LOG",
      scope: "postgres",
      msg: "2026-09-30 10:00:00.123 UTC [57] FATAL:  fake",
    });
  });
});

test("parseRedisLineは記号でレベルを判定する", () => {
  expect(parseRedisLine("1:M 30 Sep 2026 10:00:00.123 # WARNING overcommit_memory is set to 0!")).toEqual({
    level: "WARN",
    scope: "server",
    msg: "WARNING overcommit_memory is set to 0!",
  });
  expect(parseRedisLine("1:M 30 Sep 2026 10:00:00.123 * DB saved on disk").level).toBe("INFO");
});

test("toInfraLogEntryは不正な通知・空行を捨てる", () => {
  const now = new Date("2026-09-30T00:00:00.000Z");
  expect(toInfraLogEntry("not json", now)).toBeNull();
  expect(toInfraLogEntry(JSON.stringify({ service: "bot", line: "x" }), now)).toBeNull();
  expect(toInfraLogEntry(JSON.stringify({ service: "redis", line: "  " }), now)).toBeNull();
  expect(toInfraLogEntry(JSON.stringify({ service: "redis", line: "hello" }), now)).toEqual({
    at: "2026-09-30T00:00:00.000Z",
    service: "redis",
    level: "INFO",
    scope: "server",
    msg: "hello",
  });
});

test("parseLogStreamは有効なエントリだけを返す", () => {
  const entry = { at: "2026-09-30T00:00:00.000Z", service: "bot", level: "INFO", scope: "bot", msg: "ready" };
  expect(
    parseLogStream([
      ["2-0", ["entry", JSON.stringify(entry)]],
      ["1-0", ["entry", "{broken"]],
      ["0-0", ["other", "x"]],
    ]),
  ).toEqual([entry]);
});
