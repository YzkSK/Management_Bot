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
  test("1回目の上限は基準値(random=1で上限まで返る)", () => {
    expect(nextReconnectDelayMs(1, () => 1)).toBe(1000);
  });

  test("試行回数に応じて上限が倍々になる", () => {
    expect(nextReconnectDelayMs(2, () => 1)).toBe(2000);
    expect(nextReconnectDelayMs(3, () => 1)).toBe(4000);
  });

  test("上限(30秒)を超えない", () => {
    expect(nextReconnectDelayMs(10, () => 1)).toBe(30_000);
  });

  test("random=0なら待機時間0(jitterの下限)", () => {
    expect(nextReconnectDelayMs(5, () => 0)).toBe(0);
  });

  test("randomの値に応じて上限内でスケールする", () => {
    expect(nextReconnectDelayMs(2, () => 0.5)).toBe(1000);
  });
});
