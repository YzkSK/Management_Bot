import { describe, expect, test } from "bun:test";
import { buildLogWsUrl, nextReconnectDelayMs, parseLogNotificationMessage } from "./log-notifications.js";

describe("parseLogNotificationMessage", () => {
  test("正しい形式ならcategoryを取り出す", () => {
    expect(parseLogNotificationMessage(JSON.stringify({ type: "newLogEntry", category: "message" }))).toEqual({
      category: "message",
    });
  });

  test("typeが違えばnull", () => {
    expect(parseLogNotificationMessage(JSON.stringify({ type: "other", category: "message" }))).toBeNull();
  });

  test("不正なJSONはnull", () => {
    expect(parseLogNotificationMessage("not json")).toBeNull();
  });

  test("categoryが空文字ならnull", () => {
    expect(parseLogNotificationMessage(JSON.stringify({ type: "newLogEntry", category: "" }))).toBeNull();
  });
});

describe("buildLogWsUrl", () => {
  test("httpはwsに変換する", () => {
    expect(buildLogWsUrl("http://localhost:3000", "g1")).toBe("ws://localhost:3000/ws/logs/g1");
  });

  test("httpsはwssに変換する", () => {
    expect(buildLogWsUrl("https://api.example.com", "g1")).toBe("wss://api.example.com/ws/logs/g1");
  });

  test("末尾スラッシュがあっても二重スラッシュにならない", () => {
    expect(buildLogWsUrl("http://localhost:3000/", "g1")).toBe("ws://localhost:3000/ws/logs/g1");
  });
});

describe("nextReconnectDelayMs", () => {
  test("1回目は基準値", () => {
    expect(nextReconnectDelayMs(1)).toBe(1000);
  });

  test("試行回数に応じて倍々になる", () => {
    expect(nextReconnectDelayMs(2)).toBe(2000);
    expect(nextReconnectDelayMs(3)).toBe(4000);
  });

  test("上限(30秒)を超えない", () => {
    expect(nextReconnectDelayMs(10)).toBe(30_000);
  });
});
