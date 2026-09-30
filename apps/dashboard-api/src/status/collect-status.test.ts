import { describe, expect, test } from "bun:test";
import {
  evaluateBot,
  evaluateWorker,
  parseHeartbeats,
  pendingFromXinfoGroups,
  usedMemoryFromInfo,
  worst,
} from "./collect-status.js";

const now = new Date("2026-09-30T00:10:00.000Z");
const fresh = "2026-09-30T00:09:50.000Z";
const stale = "2026-09-30T00:00:00.000Z";

describe("evaluateWorker", () => {
  test("ハートビートなし・途絶は停止", () => {
    expect(evaluateWorker(undefined, now)).toBe("down");
    expect(evaluateWorker({ aliveAt: stale }, now)).toBe("down");
  });
  test("直近の実行が失敗なら停止、成功・未実行なら稼働中", () => {
    expect(evaluateWorker({ aliveAt: fresh, lastOk: false }, now)).toBe("down");
    expect(evaluateWorker({ aliveAt: fresh, lastOk: true }, now)).toBe("ok");
    expect(evaluateWorker({ aliveAt: fresh }, now)).toBe("ok");
  });
});

describe("evaluateBot", () => {
  test("Gateway未接続は停止、ping遅延は遅延", () => {
    expect(evaluateBot({ aliveAt: fresh, detail: { ready: 0 } }, now)).toBe("down");
    expect(evaluateBot({ aliveAt: fresh, detail: { ready: 1, pingMs: 1500 } }, now)).toBe("warn");
    expect(evaluateBot({ aliveAt: fresh, detail: { ready: 1, pingMs: 40 } }, now)).toBe("ok");
  });
});

test("worstは最も悪い状態を返す", () => {
  expect(worst([])).toBe("ok");
  expect(worst(["ok", "warn", "ok"])).toBe("warn");
  expect(worst(["warn", "down", "ok"])).toBe("down");
});

test("parseHeartbeatsは壊れたエントリを無視する", () => {
  const map = parseHeartbeats({ bot: JSON.stringify({ aliveAt: fresh }), backup: "{", x: '{"foo":1}' });
  expect([...map.keys()]).toEqual(["bot"]);
});

test("pendingFromXinfoGroupsは対象groupのlag+pendingを返す", () => {
  const reply = [
    ["name", "activity", "pending", 5, "lag", 1],
    ["name", "logging", "pending", 3, "lag", 120],
  ];
  expect(pendingFromXinfoGroups(reply, "logging")).toBe(123);
  expect(pendingFromXinfoGroups(reply, "missing")).toBe(0);
  expect(pendingFromXinfoGroups("bad", "logging")).toBe(0);
});

test("usedMemoryFromInfoはused_memoryを取り出す", () => {
  expect(usedMemoryFromInfo("# Memory\r\nused_memory:1048576\r\nused_memory_human:1.00M\r\n")).toBe(1048576);
  expect(usedMemoryFromInfo("")).toBeNull();
});
