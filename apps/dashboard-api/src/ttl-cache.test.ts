import { describe, expect, test } from "bun:test";
import { createTtlCache } from "./ttl-cache.ts";

describe("createTtlCache", () => {
  test("TTL内の同時呼び出しはloadを1回しか実行しない(in-flight共有)", async () => {
    const cache = createTtlCache<number>(10_000);
    let calls = 0;
    const load = async () => {
      calls++;
      return 42;
    };

    const [a, b, c] = await Promise.all([cache("k", load), cache("k", load), cache("k", load)]);

    expect(calls).toBe(1);
    expect([a, b, c]).toEqual([42, 42, 42]);
  });

  test("keyが異なれば別々にloadする", async () => {
    let calls = 0;
    const cache = createTtlCache<number>(10_000);
    const load = async () => {
      calls++;
      return calls;
    };

    const a = await cache("k1", load);
    const b = await cache("k2", load);

    expect(a).toBe(1);
    expect(b).toBe(2);
  });

  test("TTL経過後は再度loadする", async () => {
    const cache = createTtlCache<number>(1);
    let calls = 0;
    const load = async () => {
      calls++;
      return calls;
    };

    const first = await cache("k", load);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await cache("k", load);

    expect(first).toBe(1);
    expect(second).toBe(2);
  });

  test("loadが失敗した場合はキャッシュせず、次回呼び出しで再試行する", async () => {
    const cache = createTtlCache<number>(10_000);
    let calls = 0;
    const load = async () => {
      calls++;
      if (calls === 1) throw new Error("boom");
      return calls;
    };

    await expect(cache("k", load)).rejects.toThrow("boom");
    const second = await cache("k", load);

    expect(second).toBe(2);
  });

  test("TTL経過後に新エントリを積んだ後、古いエントリの遅延失敗が新エントリを消さない", async () => {
    const cache = createTtlCache<number>(1);
    let rejectFirst: ((error: Error) => void) | undefined;
    const first = cache(
      "k",
      () =>
        new Promise<number>((_resolve, reject) => {
          rejectFirst = reject;
        }),
    );

    // TTL(1ms)を経過させ、新しいエントリで置き換える。
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = cache("k", async () => 2);
    expect(await second).toBe(2);

    // 1つ目の(古い)呼び出しが今頃失敗しても、2つ目のキャッシュ済みエントリを消してはいけない。
    rejectFirst?.(new Error("stale failure"));
    await expect(first).rejects.toThrow("stale failure");

    const third = await cache("k", async () => 3);
    expect(third).toBe(2); // 新エントリがまだ生きていればキャッシュヒットするはず
  });
});
