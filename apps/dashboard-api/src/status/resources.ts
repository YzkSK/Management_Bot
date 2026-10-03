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

/** cAdvisorのmachine/ルートコンテナの応答からホスト全体の使用状況を取り出す。必要な値が揃わなければnull。 */
export function parseCadvisorHost(machine: unknown, root: unknown): ResourceSample["host"] | null {
  const m = machineSchema.safeParse(machine);
  const r = rootSchema.safeParse(root);
  if (!m.success || !r.success) return null;
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

  return {
    cpuPercent: cpu,
    memUsedBytes: last.memory.working_set,
    memTotalBytes: m.data.memory_capacity,
    diskUsedBytes: disk?.usage ?? 0,
    diskTotalBytes: disk?.capacity ?? 0,
    netRxBytesPerSec: Math.max(0, (after.rx - before.rx) / elapsedSec),
    netTxBytesPerSec: Math.max(0, (after.tx - before.tx) / elapsedSec),
    cores,
  };
}

const containerListSchema = z.array(z.object({ Id: z.string(), Labels: z.record(z.string(), z.string()).nullish() }));
const containerStatsSchema = z.object({
  cpu_stats: z.object({ cpu_usage: z.object({ total_usage: z.number() }), system_cpu_usage: z.number().optional() }),
  precpu_stats: z
    .object({ cpu_usage: z.object({ total_usage: z.number() }).optional(), system_cpu_usage: z.number().optional() })
    .optional(),
  memory_stats: z.object({ usage: z.number(), stats: z.object({ inactive_file: z.number().optional() }).optional() }),
});
const containerInspectSchema = z.object({ State: z.object({ StartedAt: z.string() }) });

/** Docker Engine APIの1コンテナ分のstatsから、ホスト全コア合計に対するCPU%とメモリ使用量(キャッシュ除く)を出す。 */
export function parseContainerStats(stats: unknown): { cpuPercent: number; memUsedBytes: number } | null {
  const s = containerStatsSchema.safeParse(stats);
  if (!s.success) return null;
  const { cpu_stats: cpu, precpu_stats: pre, memory_stats: mem } = s.data;
  const cpuDelta = cpu.cpu_usage.total_usage - (pre?.cpu_usage?.total_usage ?? Number.NaN);
  const systemDelta = (cpu.system_cpu_usage ?? Number.NaN) - (pre?.system_cpu_usage ?? Number.NaN);
  // precpu欠落(NaN)や分母0以下は0%とする。
  const percent = systemDelta > 0 && Number.isFinite(cpuDelta) ? Math.max(0, (cpuDelta / systemDelta) * 100) : 0;
  return { cpuPercent: percent, memUsedBytes: Math.max(0, mem.usage - (mem.stats?.inactive_file ?? 0)) };
}

/** docker-socket-proxy経由でcompose管理下のコンテナの使用状況を取る。個別コンテナの失敗はスキップ、一覧が取れなければ例外。 */
export async function fetchContainers(
  dockerApiUrl: string,
  { fetch: fetchFn = globalThis.fetch }: { fetch?: FetchFn } = {},
): Promise<ResourceSample["containers"]> {
  const base = dockerApiUrl.replace(/\/$/, "");
  const get = async (path: string): Promise<unknown> => {
    const res = await fetchFn(`${base}${path}`, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) throw new Error(`Docker API ${path} responded not ok`);
    return res.json();
  };
  const list = containerListSchema.parse(await get("/containers/json"));
  const results = await Promise.all(
    list.map(async ({ Id, Labels }) => {
      const name = Labels?.[SERVICE_LABEL];
      if (!name) return null;
      try {
        const [stats, inspect] = await Promise.all([get(`/containers/${Id}/stats?stream=false`), get(`/containers/${Id}/json`)]);
        const parsed = parseContainerStats(stats);
        const info = containerInspectSchema.safeParse(inspect);
        return parsed && info.success ? { name, ...parsed, startedAt: info.data.State.StartedAt } : null;
      } catch {
        return null;
      }
    }),
  );
  return results.filter((c): c is NonNullable<typeof c> => c !== null);
}

/** ioredisのRedisが構造的に満たす最小インターフェース。 */
export interface ResourceRedis {
  lpush(key: string, value: string): Promise<unknown>;
  ltrim(key: string, start: number, stop: number): Promise<unknown>;
  lrange(key: string, start: number, stop: number): Promise<string[]>;
}

type FetchFn = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

/**
 * ホスト(cAdvisor)とコンテナ別(Docker API)を並列に取得して1サンプルにする。
 * ホストが想定外の応答ならnull、cAdvisorの通信失敗は例外。コンテナ側の失敗・未設定は containers: [] で返す。
 */
export async function fetchResourceSample(
  cadvisorUrl: string,
  dockerApiUrl: string | undefined,
  { fetch: fetchFn = globalThis.fetch, now = () => new Date() }: { fetch?: FetchFn; now?: () => Date } = {},
): Promise<ResourceSample | null> {
  const base = cadvisorUrl.replace(/\/$/, "");
  const get = async (path: string): Promise<unknown> => {
    const res = await fetchFn(`${base}${path}`, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) throw new Error(`cAdvisor ${path} responded not ok`);
    return res.json();
  };
  const [[machine, root], containers] = await Promise.all([
    Promise.all([get("/api/v1.3/machine"), get("/api/v1.3/containers/")]),
    dockerApiUrl ? fetchContainers(dockerApiUrl, { fetch: fetchFn }).catch(() => []) : [],
  ]);
  const host = parseCadvisorHost(machine, root);
  return host ? { at: now().toISOString(), host, containers } : null;
}

async function sampleOnce(
  redis: ResourceRedis,
  cadvisorUrl: string,
  dockerApiUrl: string | undefined,
  options: Parameters<typeof fetchResourceSample>[2],
): Promise<void> {
  const sample = await fetchResourceSample(cadvisorUrl, dockerApiUrl, options);
  if (!sample) throw new Error("unexpected cAdvisor response");
  await redis.lpush(INFRA_RESOURCES_KEY, JSON.stringify(sample));
  await redis.ltrim(INFRA_RESOURCES_KEY, 0, RESOURCE_SAMPLE_MAXLEN - 1);
}

/** 起動時に1回即実行し、以降は60秒ごとにcAdvisorから採取してRedisのListへ積む。失敗は警告のみで続行する。 */
export function startResourceSampler(
  redis: ResourceRedis,
  cadvisorUrl: string,
  dockerApiUrl: string | undefined,
  options: { fetch?: FetchFn; now?: () => Date } = {},
): () => void {
  const run = () =>
    sampleOnce(redis, cadvisorUrl, dockerApiUrl, options).catch((error: unknown) => {
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
