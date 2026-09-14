import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { emitCorrelated, waitForCorrelated } from "./correlation-events.js";

describe("correlation-events", () => {
  test("emitCorrelatedより後にwaitForCorrelatedを呼んでも即座にtrueで解決する(先着イベントの取りこぼし防止)", async () => {
    const id = randomUUID();
    emitCorrelated(id);

    const result = await waitForCorrelated(id, 1_000);
    expect(result).toBe(true);
  });

  test("waitForCorrelated中にemitCorrelatedが呼ばれるとtrueで解決する", async () => {
    const id = randomUUID();
    const promise = waitForCorrelated(id, 5_000);

    emitCorrelated(id);

    expect(await promise).toBe(true);
  });

  test("timeoutMs以内にemitCorrelatedが呼ばれなければfalseでタイムアウトする", async () => {
    const id = randomUUID();
    const result = await waitForCorrelated(id, 50);
    expect(result).toBe(false);
  });

  test("無関係なidのemitCorrelatedは待機中の別idに影響しない", async () => {
    const id = randomUUID();
    const otherId = randomUUID();
    const promise = waitForCorrelated(id, 100);

    emitCorrelated(otherId);

    expect(await promise).toBe(false);
  });
});
