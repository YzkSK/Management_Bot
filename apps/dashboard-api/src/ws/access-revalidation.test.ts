import { describe, expect, test } from "bun:test";
import { startAccessRevalidation } from "./access-revalidation.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("startAccessRevalidation", () => {
  test("checkがコードを返したらそのコードでcloseする", async () => {
    const closed: Array<[number, string]> = [];
    const stop = startAccessRevalidation(async () => 4003, (code, reason) => closed.push([code, reason]), 10);
    await sleep(50);
    stop();
    expect(closed).toEqual([[4003, "access revoked"]]);
  });

  test("checkがnullを返す間はcloseしない", async () => {
    let calls = 0;
    const closed: number[] = [];
    const stop = startAccessRevalidation(
      async () => {
        calls += 1;
        return null;
      },
      (code) => closed.push(code),
      10,
    );
    await sleep(50);
    stop();
    expect(calls).toBeGreaterThan(1);
    expect(closed).toEqual([]);
  });

  test("checkがthrowしてもcloseせず再検証を続ける", async () => {
    let calls = 0;
    const errors: unknown[] = [];
    const closed: number[] = [];
    const stop = startAccessRevalidation(
      async () => {
        calls += 1;
        throw new Error("discord down");
      },
      (code) => closed.push(code),
      10,
      (error) => errors.push(error),
    );
    await sleep(50);
    stop();
    expect(calls).toBeGreaterThan(1);
    expect(errors.length).toBeGreaterThan(0);
    expect(closed).toEqual([]);
  });

  test("stop後はcheckが呼ばれない", async () => {
    let calls = 0;
    const stop = startAccessRevalidation(
      async () => {
        calls += 1;
        return null;
      },
      () => {},
      10,
    );
    stop();
    await sleep(50);
    expect(calls).toBe(0);
  });
});
