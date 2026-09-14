import { describe, expect, test } from "bun:test";
import { createDb } from "./client.ts";

describe("createDb options.max", () => {
  test("0以下はRangeErrorを投げる", () => {
    expect(() => createDb("postgres://localhost/dummy", { max: 0 })).toThrow(RangeError);
  });

  test("非整数はRangeErrorを投げる", () => {
    expect(() => createDb("postgres://localhost/dummy", { max: 1.5 })).toThrow(RangeError);
  });

  test("正の整数は受理される", () => {
    const { close } = createDb("postgres://localhost/dummy", { max: 1 });
    void close();
  });
});
