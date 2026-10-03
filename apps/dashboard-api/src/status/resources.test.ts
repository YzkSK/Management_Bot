import { describe, expect, test } from "bun:test";
import { INFRA_RESOURCES_KEY, RESOURCE_SAMPLE_MAXLEN, resourceSampleSchema, type ResourceSample } from "@management-bot/shared";
import { parseCadvisor, readResourceSamples, startResourceSampler, type ResourceRedis } from "./resources.js";

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
const docker = {
  abc: {
    spec: { creation_time: "2026-10-01T00:00:00Z", labels: { "com.docker.compose.service": "bot" } },
    stats: [stat(0, 0, 100), stat(30, 12e9, 200)],
  },
  nolabel: { spec: { creation_time: "2026-10-01T00:00:00Z" }, stats: [stat(0, 0, 1), stat(30, 1, 1)] },
  single: {
    spec: { creation_time: "2026-10-01T00:00:00Z", labels: { "com.docker.compose.service": "redis" } },
    stats: [stat(30, 1, 1)],
  },
};

describe("parseCadvisor", () => {
  test("ホストとコンテナの使用状況を取り出す", () => {
    const sample = parseCadvisor(machine, root, docker, AT);
    expect(sample).not.toBeNull();
    expect(sample?.host.cpuPercent).toBeCloseTo(50);
    expect(sample?.host.memUsedBytes).toBe(2 * GB);
    expect(sample?.host.memTotalBytes).toBe(8 * GB);
    expect(sample?.host.diskUsedBytes).toBe(40 * GB);
    expect(sample?.host.diskTotalBytes).toBe(100 * GB);
    expect(sample?.host.netRxBytesPerSec).toBeCloseTo(2000);
    expect(sample?.host.netTxBytesPerSec).toBeCloseTo(1000);
    expect(sample?.host.cores).toBe(4);
    // ラベル無し・stats1点のコンテナは除外される
    expect(sample?.containers).toEqual([
      { name: "bot", cpuPercent: expect.closeTo(10), memUsedBytes: 200, startedAt: "2026-10-01T00:00:00Z" },
    ]);
    expect(resourceSampleSchema.safeParse(sample).success).toBe(true);
  });

  test("ルートのstatsが1点ならnull", () => {
    expect(parseCadvisor(machine, { stats: [stat(0, 0, 1)] }, docker, AT)).toBeNull();
  });

  test("不正な入力はnull", () => {
    expect(parseCadvisor(null, root, docker, AT)).toBeNull();
    expect(parseCadvisor(machine, "x", docker, AT)).toBeNull();
    expect(parseCadvisor(machine, root, { a: 1 }, AT)).toBeNull();
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
      "/api/v1.3/docker/": docker,
    };
    const stop = startResourceSampler(redis, "http://cadvisor:8080/", {
      fetch: async (url) => ({ ok: true, json: async () => payloads[url.replace("http://cadvisor:8080", "")] }),
      now: () => AT,
    });
    await Bun.sleep(20);
    stop();
    expect(redis.calls).toEqual([`lpush ${INFRA_RESOURCES_KEY} true`, `ltrim ${INFRA_RESOURCES_KEY} 0 ${RESOURCE_SAMPLE_MAXLEN - 1}`]);

    const failing = fakeRedis([]);
    const stop2 = startResourceSampler(failing, "http://cadvisor:8080", { fetch: async () => Promise.reject(new Error("down")) });
    await Bun.sleep(20);
    stop2();
    expect(failing.calls).toEqual([]);
  });
});
