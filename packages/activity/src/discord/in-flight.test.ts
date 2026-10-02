import { describe, expect, test } from "bun:test";
import { InFlightWrites } from "./in-flight.js";

describe("InFlightWrites", () => {
  test("drainは実行中の書き込みがすべて終わるまで待つ(失敗も含めて待ち、例外は投げない)", async () => {
    const inFlight = new InFlightWrites();
    const first = Promise.withResolvers<void>();
    const second = Promise.withResolvers<void>();
    const order: string[] = [];
    void inFlight.track(first.promise).then(() => order.push("first"));
    void inFlight.track(second.promise).catch(() => order.push("second failed"));

    const drained = inFlight.drain().then(() => order.push("drained"));
    first.resolve();
    second.reject(new Error("db down"));
    await drained;

    expect(order).toEqual(["first", "second failed", "drained"]);
  });

  test("何も無ければ即座に終わる", async () => {
    await expect(new InFlightWrites().drain()).resolves.toBeUndefined();
  });
});
