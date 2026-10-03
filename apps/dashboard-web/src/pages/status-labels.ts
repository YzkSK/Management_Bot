import type { ServiceState, StatusItem } from "@management-bot/dashboard-api";
import type { InfraLogEntry, InfraLogService } from "@management-bot/shared";

export type { StatusItem };

/** ステータスの配色はデザイントークン(success/warning/destructive)に揃える。 */
export const STATE_META: Record<ServiceState, { label: string; lamp: string; summary: string; dot: string; ring: string; badge: string; box: string }> = {
  ok: {
    label: "稼働中",
    lamp: "正常",
    summary: "すべての機能が正常に稼働しています",
    dot: "bg-success",
    ring: "ring-success/20",
    badge: "bg-success/10 text-success",
    box: "border-success/30 bg-success/10 text-success",
  },
  warn: {
    label: "遅延",
    lamp: "遅延あり",
    summary: "一部の機能で遅延が発生しています",
    dot: "bg-warning",
    ring: "ring-warning/20",
    badge: "bg-warning/10 text-warning",
    box: "border-warning/30 bg-warning/10 text-warning",
  },
  down: {
    label: "停止",
    lamp: "停止あり",
    summary: "一部の機能が停止しています",
    dot: "bg-destructive",
    ring: "ring-destructive/20",
    badge: "bg-destructive/10 text-destructive",
    box: "border-destructive/30 bg-destructive/10 text-destructive",
  },
};

export const ITEM_META: Record<StatusItem["key"], { name: string; group: "infra" | "feature"; logService?: InfraLogService }> = {
  bot: { name: "Bot(Discord接続)", group: "infra", logService: "bot" },
  api: { name: "Dashboard API", group: "infra", logService: "api" },
  postgres: { name: "PostgreSQL", group: "infra", logService: "postgres" },
  redis: { name: "Redis", group: "infra", logService: "redis" },
  activity: { name: "アクティビティモニター", group: "feature" },
  logging: { name: "ログ機能", group: "feature" },
  tempVoice: { name: "一時VC", group: "feature" },
  moderation: { name: "スパム対策", group: "feature" },
  backup: { name: "バックアップ", group: "feature" },
  sessionCleanup: { name: "セッション清掃", group: "feature" },
};

const dateTime = new Intl.DateTimeFormat("ja-JP", { dateStyle: "short", timeStyle: "short" });
export const formatDateTime = (iso: string) => dateTime.format(new Date(iso));
const lastRun = (prefix: string, iso: string | null) => `${prefix} ${iso ? formatDateTime(iso) : "未実行"}`;

/** 各行の補足文。値が無い(未報告・接続不可)ときは状態だけが伝わる文にする。 */
export function describeItem(item: StatusItem): string {
  const v = item.values;
  switch (item.key) {
    case "bot":
      return item.state === "down" || v.pingMs === undefined
        ? "Discordに接続していません"
        : `Gateway ping ${v.pingMs}ms ・ 参加サーバー ${v.guilds ?? 0}`;
    case "api":
      return `応答 ${v.responseMs ?? 0}ms`;
    case "postgres":
      return v.connections === undefined ? "接続できません" : `接続 ${v.connections} / ${v.maxConnections}`;
    case "redis":
      return v.usedMemoryBytes === undefined ? "接続できません" : `メモリ ${(v.usedMemoryBytes / 1024 / 1024).toFixed(1)}MB`;
    case "activity":
      return lastRun("日次集計 最終実行", item.lastRunAt);
    case "logging":
      return item.state === "warn"
        ? `未処理イベント ${v.pendingEvents ?? 0}件(処理が遅れています)`
        : `未処理イベント ${v.pendingEvents ?? 0}件 ・ ${lastRun("保持期間削除 最終実行", item.lastRunAt)}`;
    case "tempVoice":
      return item.state === "down" ? "イベント処理が停止しています(Botが停止中)" : `管理中のVC ${v.channels ?? 0}`;
    case "moderation":
      return lastRun("警告回数の減衰 最終実行", item.lastRunAt);
    case "backup":
      return lastRun("最終実行", item.lastRunAt);
    case "sessionCleanup":
      return lastRun("最終実行", item.lastRunAt);
  }
}

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;
/** 1024進数で「20.6 GB」形式にする。 */
export function formatBytes(bytes: number): string {
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${unit === 0 ? Math.round(value) : value.toFixed(1)} ${BYTE_UNITS[unit]}`;
}

/** 経過時間を「3日 4時間」「4時間 5分」「5分」にする。 */
export function formatUptime(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  if (days > 0) return `${days}日 ${hours}時間`;
  if (hours > 0) return `${hours}時間 ${minutes % 60}分`;
  return `${minutes}分`;
}

/** 使用率に応じたバーの色。80%以上で警告、90%以上で危険。 */
export const usageBarClass = (percent: number) =>
  percent >= 90 ? "bg-destructive" : percent >= 80 ? "bg-warning" : "bg-success";

/** 値の列をSVGのpolyline用`x,y`列にする。yは0〜max(はみ出しは丸める)を高さheightへ反転して写す。 */
export function toPolylinePoints(values: readonly number[], max: number, width: number, height: number): string {
  const last = Math.max(values.length - 1, 1);
  return values
    .map((v, i) => `${((i / last) * width).toFixed(1)},${(height - (Math.min(Math.max(v, 0), max) / max) * height).toFixed(1)}`)
    .join(" ");
}

/** 総合ログのサービス名ラベル(暗いログ背景上の色)。 */
export const SERVICE_META: Record<InfraLogService, { label: string; text: string; bar: string }> = {
  bot: { label: "Bot", text: "text-blue-400", bar: "bg-blue-400" },
  api: { label: "API", text: "text-purple-400", bar: "bg-purple-400" },
  worker: { label: "ワーカー", text: "text-teal-400", bar: "bg-teal-400" },
  postgres: { label: "PostgreSQL", text: "text-pink-400", bar: "bg-pink-400" },
  redis: { label: "Redis", text: "text-orange-400", bar: "bg-orange-400" },
};

export type LevelFilter = "all" | "warn" | "error";

export function filterLogs(entries: readonly InfraLogEntry[], level: LevelFilter, search: string): InfraLogEntry[] {
  const needle = search.trim().toLowerCase();
  return entries.filter(
    (entry) =>
      (level === "all" || entry.level === "ERROR" || (level === "warn" && entry.level === "WARN")) &&
      (needle === "" || entry.msg.toLowerCase().includes(needle)),
  );
}

export const LEVEL_STYLE: Record<InfraLogEntry["level"], { text: string; row: string }> = {
  ERROR: { text: "text-red-400", row: "bg-red-500/15" },
  WARN: { text: "text-amber-400", row: "bg-amber-500/10" },
  INFO: { text: "text-emerald-400", row: "" },
  LOG: { text: "text-zinc-400", row: "" },
  DEBUG: { text: "text-zinc-400", row: "" },
};
