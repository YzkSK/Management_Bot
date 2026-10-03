import {
  INFRA_RESOURCES_KEY,
  RESOURCE_SAMPLE_INTERVAL_MS,
  RESOURCE_SAMPLE_MAXLEN,
  resourceSampleSchema,
  type ResourceSample,
} from "@management-bot/shared";
import { z } from "zod";

const machineSchema = z.object({ num_cores: z.number(), memory_capacity: z.number() });

const statSchema = z.object({
  timestamp: z.string(),
  cpu: z.object({ usage: z.object({ total: z.number() }) }),
  memory: z.object({ working_set: z.number() }),
  network: z
    .object({ interfaces: z.array(z.object({ rx_bytes: z.number(), tx_bytes: z.number() })).optional() })
    .optional(),
  filesystem: z.array(z.object({ capacity: z.number(), usage: z.number() })).optional(),
});
type Stat = z.infer<typeof statSchema>;

const rootSchema = z.object({ stats: z.array(statSchema) });
const dockerSchema = z.record(
  z.string(),
  z.object({
    spec: z.object({ creation_time: z.string(), labels: z.record(z.string(), z.string()).optional() }),
    stats: z.array(statSchema),
  }),
);

const SERVICE_LABEL = "com.docker.compose.service";

/** 直近2点のCPU使用量(ns)の差分から、ホスト全コア合計に対する使用率(%)を出す。 */
function cpuPercent(prev: Stat, last: Stat, cores: number): number | null {
  const elapsedNs = (Date.parse(last.timestamp) - Date.parse(prev.timestamp)) * 1e6;
  if (!(elapsedNs > 0)) return null;
  return Math.max(0, ((last.cpu.usage.total - prev.cpu.usage.total) / elapsedNs / cores) * 100);
}

const netTotals = (stat: Stat) => {
  const ifaces = stat.network?.interfaces ?? [];
  return { rx: ifaces.reduce((sum, i) => sum + i.rx_bytes, 0), tx: ifaces.reduce((sum, i) => sum + i.tx_bytes, 0) };
};

/** cAdvisorの3エンドポイントの応答を1サンプルにまとめる。必要な値が揃わなければnull。 */
export function parseCadvisor(machine: unknown, root: unknown, docker: unknown, at: Date): ResourceSample | null {
  const m = machineSchema.safeParse(machine);
  const r = rootSchema.safeParse(root);
  const d = dockerSchema.safeParse(docker);
  if (!m.success || !r.success || !d.success) return null;
  const cores = m.data.num_cores;
  const [prev, last] = r.data.stats.slice(-2);
  if (!prev || !last || cores <= 0) return null;
  const cpu = cpuPercent(prev, last, cores);
  if (cpu === null) return null;

  const elapsedSec = (Date.parse(last.timestamp) - Date.parse(prev.timestamp)) / 1000;
  const [before, after] = [netTotals(prev), netTotals(last)];
  const disk = (last.filesystem ?? []).reduce<{ capacity: number; usage: number } | null>(
    (best, fs) => (best === null || fs.capacity > best.capacity ? fs : best),
    null,
  );

  const containers: ResourceSample["containers"] = [];
  for (const container of Object.values(d.data)) {
    const name = container.spec.labels?.[SERVICE_LABEL];
    const [cPrev, cLast] = container.stats.slice(-2);
    if (!name || !cPrev || !cLast) continue;
    const percent = cpuPercent(cPrev, cLast, cores);
    if (percent === null) continue;
    containers.push({
      name,
      cpuPercent: percent,
      memUsedBytes: cLast.memory.working_set,
      startedAt: container.spec.creation_time,
    });
  }

  return {
    at: at.toISOString(),
    host: {
      cpuPercent: cpu,
      memUsedBytes: last.memory.working_set,
      memTotalBytes: m.data.memory_capacity,
      diskUsedBytes: disk?.usage ?? 0,
      diskTotalBytes: disk?.capacity ?? 0,
      netRxBytesPerSec: Math.max(0, (after.rx - before.rx) / elapsedSec),
      netTxBytesPerSec: Math.max(0, (after.tx - before.tx) / elapsedSec),
      cores,
    },
    containers,
  };
}

/** ioredisのRedisが構造的に満たす最小インターフェース。 */
export interface ResourceRedis {
  lpush(key: string, value: string): Promise<unknown>;
  ltrim(key: string, start: number, stop: number): Promise<unknown>;
  lrange(key: string, start: number, stop: number): Promise<string[]>;
}

type FetchFn = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

async function sampleOnce(redis: ResourceRedis, base: string, fetchFn: FetchFn, now: () => Date): Promise<void> {
  const get = async (path: string): Promise<unknown> => {
    const res = await fetchFn(`${base}${path}`, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) throw new Error(`cAdvisor ${path} responded not ok`);
    return res.json();
  };
  const [machine, root, docker] = await Promise.all([
    get("/api/v1.3/machine"),
    get("/api/v1.3/containers/"),
    get("/api/v1.3/docker/"),
  ]);
  const sample = parseCadvisor(machine, root, docker, now());
  if (!sample) throw new Error("unexpected cAdvisor response");
  await redis.lpush(INFRA_RESOURCES_KEY, JSON.stringify(sample));
  await redis.ltrim(INFRA_RESOURCES_KEY, 0, RESOURCE_SAMPLE_MAXLEN - 1);
}

/** 起動時に1回即実行し、以降は60秒ごとにcAdvisorから採取してRedisのListへ積む。失敗は警告のみで続行する。 */
export function startResourceSampler(
  redis: ResourceRedis,
  cadvisorUrl: string,
  { fetch: fetchFn = globalThis.fetch, now = () => new Date() }: { fetch?: FetchFn; now?: () => Date } = {},
): () => void {
  const base = cadvisorUrl.replace(/\/$/, "");
  const run = () =>
    sampleOnce(redis, base, fetchFn, now).catch((error: unknown) => {
      console.warn("Failed to sample resources from cAdvisor", error);
    });
  void run();
  const timer = setInterval(run, RESOURCE_SAMPLE_INTERVAL_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}

export type ResourceRange = "1h" | "24h" | "7d";
const RANGES: Record<ResourceRange, { count: number; maxPoints: number }> = {
  "1h": { count: 60, maxPoints: 60 },
  "24h": { count: 1440, maxPoints: 288 },
  "7d": { count: 10_080, maxPoints: 336 },
};

/** 新しい順のListから期間分を読み、壊れた要素を捨てて古い順に返す。 */
export async function readResourceSamples(redis: ResourceRedis, range: ResourceRange): Promise<ResourceSample[]> {
  const { count, maxPoints } = RANGES[range];
  const raw = await redis.lrange(INFRA_RESOURCES_KEY, 0, count - 1);
  const samples: ResourceSample[] = [];
  for (const item of raw) {
    try {
      const parsed = resourceSampleSchema.safeParse(JSON.parse(item));
      if (parsed.success) samples.push(parsed.data);
    } catch {
      // 壊れた要素は読み飛ばす
    }
  }
  samples.reverse();
  if (samples.length <= maxPoints) return samples;
  // ponytail: 平均化せず一定間隔で抽出するだけ(グラフ用途のため)。短いスパイクが落ちるのが気になれば区間max/平均に変える。
  // 最新点が必ず残るよう、先頭と末尾を端にして等間隔に取る。
  const step = (samples.length - 1) / (maxPoints - 1);
  return Array.from({ length: maxPoints }, (_, i) => samples[Math.round(i * step)]).filter(
    (s): s is ResourceSample => s !== undefined,
  );
}
