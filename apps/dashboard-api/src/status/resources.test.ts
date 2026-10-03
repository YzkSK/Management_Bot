import { describe, expect, test } from "bun:test";
import { INFRA_RESOURCES_KEY, RESOURCE_SAMPLE_MAXLEN, resourceSampleSchema, type ResourceSample } from "@management-bot/shared";
import {
  fetchContainers,
  fetchResourceSample,
  parseCadvisorHost,
  readResourceSamples,
  startResourceSampler,
  type ResourceRedis,
} from "./resources.js";

type FetchFn = NonNullable<Parameters<typeof fetchContainers>[1]>["fetch"] & {};

const GB = 1024 ** 3;
const AT = new Date("2026-10-03T00:00:00.000Z");

const stat = (seconds: number, cpuNs: number, mem: number, rx = 0, tx = 0) => ({
  timestamp: new Date(Date.UTC(2026, 9, 3, 0, 0, seconds)).toISOString(),
  cpu: { usage: { total: cpuNs } },
  memory: { working_set: mem },
  network: { interfaces: [{ rx_bytes: rx, tx_bytes: tx }, { rx_bytes: rx, tx_bytes: tx }] },
  filesystem: [
    { capacity: 10 * GB, usage: 1 * GB },
    { capacity: 100 * GB, usage: 40 * GB },
  ],
});

const machine = { num_cores: 4, memory_capacity: 8 * GB };
// 30秒で2コア分(= 4コア中50%)を使用、NICは2本合計で1秒あたり rx 2000B / tx 1000B
const root = { stats: [stat(0, 0, 1 * GB, 0, 0), stat(30, 60e9, 2 * GB, 30_000, 15_000)] };

describe("parseCadvisorHost", () => {
  test("ホスト全体の使用状況を取り出す", () => {
    const host = parseCadvisorHost(machine, root);
    expect(host?.cpuPercent).toBeCloseTo(50);
    expect(host?.memUsedBytes).toBe(2 * GB);
    expect(host?.memTotalBytes).toBe(8 * GB);
    expect(host?.diskUsedBytes).toBe(40 * GB);
    expect(host?.diskTotalBytes).toBe(100 * GB);
    expect(host?.netRxBytesPerSec).toBeCloseTo(2000);
    expect(host?.netTxBytesPerSec).toBeCloseTo(1000);
    expect(host?.cores).toBe(4);
  });

  test("ルートのstatsが1点ならnull", () => {
    expect(parseCadvisorHost(machine, { stats: [stat(0, 0, 1)] })).toBeNull();
  });

  test("不正な入力はnull", () => {
    expect(parseCadvisorHost(null, root)).toBeNull();
    expect(parseCadvisorHost(machine, "x")).toBeNull();
  });
});

// Docker Engine APIのフィクスチャ。botはホスト全体のCPU差分(1000)のうち100 = 10%、メモリは usage 300 - inactive_file 100 = 200。
const dockerStats = (cpu: number, preCpu: number | undefined, system: number, preSystem: number | undefined, usage: number, inactive?: number) => ({
  cpu_stats: { cpu_usage: { total_usage: cpu }, system_cpu_usage: system },
  precpu_stats: preCpu === undefined ? {} : { cpu_usage: { total_usage: preCpu }, system_cpu_usage: preSystem },
  memory_stats: { usage, stats: inactive === undefined ? {} : { inactive_file: inactive } },
});
const dockerApi: Record<string, unknown> = {
  "/containers/json": [
    { Id: "bot1", Labels: { "com.docker.compose.service": "bot" } },
    { Id: "nolabel", Labels: {} },
    { Id: "fresh", Labels: { "com.docker.compose.service": "redis" } },
    { Id: "broken", Labels: { "com.docker.compose.service": "postgres" } },
  ],
  "/containers/bot1/stats?stream=false": dockerStats(1100, 1000, 11_000, 10_000, 300, 100),
  "/containers/bot1/json": { State: { StartedAt: "2026-10-01T00:00:00Z" } },
  // precpu欠落は0%、メモリがinactive_fileより小さくても負にしない
  "/containers/fresh/stats?stream=false": dockerStats(1100, undefined, 11_000, undefined, 50, 100),
  "/containers/fresh/json": { State: { StartedAt: "2026-10-02T00:00:00Z" } },
};
const dockerFetch: FetchFn = async (url) => {
  const path = url.replace("http://docker-proxy:2375", "");
  if (!(path in dockerApi)) return { ok: false, json: async () => ({}) };
  return { ok: true, json: async () => dockerApi[path] };
};

describe("fetchContainers", () => {
  test("composeのサービスだけを対象に、CPU%・メモリ(inactive_file除外)・起動時刻を取る。個別の失敗はスキップ", async () => {
    expect(await fetchContainers("http://docker-proxy:2375/", { fetch: dockerFetch })).toEqual([
      { name: "bot", cpuPercent: expect.closeTo(10), memUsedBytes: 200, startedAt: "2026-10-01T00:00:00Z" },
      { name: "redis", cpuPercent: 0, memUsedBytes: 0, startedAt: "2026-10-02T00:00:00Z" },
    ]);
  });
});

describe("fetchResourceSample", () => {
  const cadvisorPayloads: Record<string, unknown> = { "/api/v1.3/machine": machine, "/api/v1.3/containers/": root };
  const route: FetchFn = (url, init) =>
    url.startsWith("http://cadvisor:8080")
      ? Promise.resolve({ ok: true, json: async () => cadvisorPayloads[url.replace("http://cadvisor:8080", "")] })
      : dockerFetch(url, init);

  test("ホストとコンテナを合わせて返す", async () => {
    const result = await fetchResourceSample("http://cadvisor:8080", "http://docker-proxy:2375", { fetch: route, now: () => AT });
    expect(result?.at).toBe(AT.toISOString());
    expect(result?.containers.map((c) => c.name)).toEqual(["bot", "redis"]);
    expect(resourceSampleSchema.safeParse(result).success).toBe(true);
  });

  test("Docker APIが失敗・未設定でもホストは返る", async () => {
    const down: FetchFn = (url, init) =>
      url.startsWith("http://cadvisor:8080") ? route(url, init) : Promise.reject(new Error("proxy down"));
    for (const dockerUrl of ["http://docker-proxy:2375", undefined]) {
      const result = await fetchResourceSample("http://cadvisor:8080", dockerUrl, { fetch: down, now: () => AT });
      expect(result?.host.cores).toBe(4);
      expect(result?.containers).toEqual([]);
    }
  });

  test("ホストが想定外の応答ならnull", async () => {
    const bad: FetchFn = async () => ({ ok: true, json: async () => ({}) });
    expect(await fetchResourceSample("http://cadvisor:8080", undefined, { fetch: bad })).toBeNull();
  });
});

const sample = (n: number): ResourceSample => ({
  at: new Date(n * 60_000).toISOString(),
  host: {
    cpuPercent: n,
    memUsedBytes: 1,
    memTotalBytes: 2,
    diskUsedBytes: 1,
    diskTotalBytes: 2,
    netRxBytesPerSec: 0,
    netTxBytesPerSec: 0,
    cores: 1,
  },
  containers: [],
});

/** LRANGEの挙動(新しい順・stop含む)だけを真似た偽Redis。 */
const fakeRedis = (items: string[]): ResourceRedis & { calls: string[] } => {
  const calls: string[] = [];
  return {
    calls,
    lpush: async (key, value) => void calls.push(`lpush ${key} ${value.length > 0}`),
    ltrim: async (key, start, stop) => void calls.push(`ltrim ${key} ${start} ${stop}`),
    lrange: async (_key, start, stop) => items.slice(start, stop + 1),
  };
};

describe("readResourceSamples", () => {
  test("壊れた要素を除き古い順に返す", async () => {
    const redis = fakeRedis([JSON.stringify(sample(3)), "not json", JSON.stringify({ at: 1 }), JSON.stringify(sample(2))]);
    const result = await readResourceSamples(redis, "1h");
    expect(result.map((s) => s.host.cpuPercent)).toEqual([2, 3]);
  });

  test("上限を超えたら最新点を残して間引く", async () => {
    const newestFirst = Array.from({ length: 1440 }, (_, i) => JSON.stringify(sample(1440 - i)));
    const result = await readResourceSamples(fakeRedis(newestFirst), "24h");
    expect(result.length).toBe(288);
    expect(result[0]?.host.cpuPercent).toBe(1);
    expect(result.at(-1)?.host.cpuPercent).toBe(1440);
  });
});

describe("startResourceSampler", () => {
  test("cAdvisorから採取してLPUSH/LTRIMする。失敗しても落ちない", async () => {
    const redis = fakeRedis([]);
    const payloads: Record<string, unknown> = {
      "/api/v1.3/machine": machine,
      "/api/v1.3/containers/": root,
    };
    const stop = startResourceSampler(redis, "http://cadvisor:8080/", undefined, {
      fetch: async (url) => ({ ok: true, json: async () => payloads[url.replace("http://cadvisor:8080", "")] }),
      now: () => AT,
    });
    await Bun.sleep(20);
    stop();
    expect(redis.calls).toEqual([`lpush ${INFRA_RESOURCES_KEY} true`, `ltrim ${INFRA_RESOURCES_KEY} 0 ${RESOURCE_SAMPLE_MAXLEN - 1}`]);

    const failing = fakeRedis([]);
    const stop2 = startResourceSampler(failing, "http://cadvisor:8080", undefined, { fetch: async () => Promise.reject(new Error("down")) });
    await Bun.sleep(20);
    stop2();
    expect(failing.calls).toEqual([]);
  });
});
