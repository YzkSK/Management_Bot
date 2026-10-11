import { CATEGORY_LABELS } from "@management-bot/shared";
import { CAPABILITY_OPTIONS } from "./capability-labels.js";
import { NGWORD_MATCH_TYPE_LABELS, PRESET_LABELS, VIOLATION_TYPE_LABELS } from "./moderation-labels.js";

/** 値の種類。表示の整形(#チャンネル・@ロール・オン/オフなど)を決める。 */
type ValueKind = "text" | "bool" | "days" | "kbps" | "channel" | "role" | "user" | "roles" | "channels" | "capabilities";

interface ChangeRow {
  label: string;
  kind: ValueKind;
  /** 変更前。undefinedなら変更前が分からない項目として変更後のみ表示する(nullは「未設定」)。 */
  before?: unknown;
  after: unknown;
  /** text項目の値→表示名(強度・違反種別など)。 */
  map?: Record<string, string>;
}

export interface AuditChange {
  label: string;
  before?: string;
  after: string;
}

/** ID→表示名。サーバーが解決できたものだけが入る。 */
export type AuditNames = Readonly<Record<string, string>>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 変更内容として表示しない、識別用・内部用のキー。 */
const HIDDEN_KEYS: ReadonlySet<string> = new Set(["guildId", "id", "createdAt", "updatedAt", "isLocked"]);

interface KeyMeta {
  label: string;
  kind: ValueKind;
  map?: Record<string, string>;
}

/** キー→日本語の項目名と値の種類。未知のキーは名前そのまま・textで表示する。 */
const KEY_META: Record<string, KeyMeta> = {
  channelId: { label: "チャンネル", kind: "channel" },
  createChannelId: { label: "作成用ボイスチャンネル", kind: "channel" },
  categoryId: { label: "カテゴリ", kind: "channel" },
  channelIds: { label: "チャンネル", kind: "channels" },
  roleId: { label: "ロール", kind: "role" },
  roleIds: { label: "ロール", kind: "roles" },
  allowedRoleIds: { label: "使えるロール", kind: "roles" },
  userId: { label: "ユーザー", kind: "user" },
  enabled: { label: "有効", kind: "bool" },
  preset: { label: "強度", kind: "text", map: PRESET_LABELS },
  violationType: { label: "違反の種類", kind: "text", map: VIOLATION_TYPE_LABELS },
  category: { label: "カテゴリ", kind: "text", map: CATEGORY_LABELS },
  matchType: { label: "一致方法", kind: "text", map: NGWORD_MATCH_TYPE_LABELS },
  pattern: { label: "パターン", kind: "text" },
  retentionDays: { label: "保存期間", kind: "days" },
  nameTemplate: { label: "チャンネル名のテンプレート", kind: "text" },
  defaultUserLimit: { label: "人数上限", kind: "text" },
  defaultBitrate: { label: "ビットレート", kind: "kbps" },
  allowEveryone: { label: "予約時に @everyone を指定できる", kind: "bool" },
  allowHere: { label: "予約時に @here を指定できる", kind: "bool" },
  hideAuditLogCorrelation: { label: "監査ログ相関を非表示", kind: "bool" },
  hideBotEvents: { label: "Botによるイベントを非表示", kind: "bool" },
  autoLockdownOnRaid: { label: "レイド検知時の自動ロックダウン", kind: "bool" },
  requestedLocked: { label: "ロックダウン", kind: "bool" },
  capabilities: { label: "権限", kind: "capabilities" },
};

function capabilityLabels(mask: number): string[] {
  return CAPABILITY_OPTIONS.filter((option) => (mask & option.bit) === option.bit).map((option) => option.label);
}

/** 権限のビットマスクの変更を「追加: …」「削除: …」の差分文にする。差がなければnull。 */
export function describeCapabilityChange(before: number, after: number): string | null {
  const added = capabilityLabels(after & ~before);
  const removed = capabilityLabels(before & ~after);
  const parts = [
    ...(added.length > 0 ? [`追加: ${added.join("、")}`] : []),
    ...(removed.length > 0 ? [`削除: ${removed.join("、")}`] : []),
  ];
  return parts.length > 0 ? parts.join(" / ") : null;
}

function nameOf(prefix: string, id: string, names: AuditNames): string {
  const name = names[id];
  return name === undefined ? id : `${prefix}${name}`;
}

function formatList(values: unknown, one: (id: string) => string): string {
  if (!Array.isArray(values)) return formatValue("text", values, {}, undefined);
  const items = values.map((v) => (typeof v === "string" ? one(v) : formatValue("text", v, {}, undefined)));
  return items.length > 0 ? items.join("、") : "なし";
}

/** 値を表示用の文字列にする。null/undefinedは「未設定」。 */
export function formatValue(
  kind: ValueKind,
  value: unknown,
  names: AuditNames,
  map: Record<string, string> | undefined,
): string {
  if (value === null || value === undefined) return "未設定";
  if (kind === "bool" && typeof value === "boolean") return value ? "オン" : "オフ";
  if (kind === "days" && typeof value === "number") return value === 0 ? "無期限" : `${value}日`;
  if (kind === "kbps" && typeof value === "number") return `${Math.round(value / 1000)}kbps`;
  if (typeof value === "string") {
    if (kind === "channel") return nameOf("#", value, names);
    if (kind === "role") return nameOf("@", value, names);
    if (kind === "user") return names[value] ?? value;
    return map?.[value] ?? value;
  }
  if (kind === "roles") return formatList(value, (id) => nameOf("@", id, names));
  if (kind === "channels") return formatList(value, (id) => nameOf("#", id, names));
  if (Array.isArray(value)) return value.length > 0 ? value.map((v) => formatValue("text", v, {}, undefined)).join("、") : "なし";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function findBy(list: unknown, key: string, value: unknown): Record<string, unknown> | undefined {
  if (!Array.isArray(list)) return undefined;
  return list.filter(isRecord).find((item) => item[key] === value);
}

/** 全項目が同じ値ならその値、バラバラなら「カテゴリごとに異なる」。リストでなければ変更前なし。 */
function uniformOf(list: unknown, key: string): unknown {
  if (!Array.isArray(list) || list.length === 0) return undefined;
  const values = list.filter(isRecord).map((item) => item[key]);
  return values.every((v) => v === values[0]) ? values[0] : "カテゴリごとに異なる";
}

const CATEGORY_NAMES: Record<string, string> = CATEGORY_LABELS;
const VIOLATION_NAMES: Record<string, string> = VIOLATION_TYPE_LABELS;

function categoryLabel(category: unknown): string {
  return typeof category === "string" ? (CATEGORY_NAMES[category] ?? category) : "カテゴリ";
}

function violationLabel(violationType: unknown): string {
  return typeof violationType === "string" ? (VIOLATION_NAMES[violationType] ?? violationType) : "検知";
}

/** 操作ごとに、保存されているbefore/after(形が操作ごとに違う)から「項目・変更前・変更後」を取り出す。 */
function specificRows(key: string, before: unknown, after: Record<string, unknown>): ChangeRow[] | null {
  switch (key) {
    case "logging.setRetentionSetting":
      return [
        {
          label: `${categoryLabel(after.category)}の保存期間`,
          kind: "days",
          before: findBy(before, "category", after.category)?.retentionDays,
          after: after.retentionDays,
        },
      ];
    case "logging.setChannelSetting":
      return [
        {
          label: `${categoryLabel(after.category)}の出力先`,
          kind: "channel",
          before: findBy(before, "category", after.category)?.channelId,
          after: after.channelId,
        },
      ];
    case "logging.setRetentionSettingForAllCategories":
      return [{ label: "全カテゴリの保存期間", kind: "days", before: uniformOf(before, "retentionDays"), after: after.retentionDays }];
    case "logging.setChannelSettingForAllCategories":
      return [{ label: "全カテゴリの出力先", kind: "channel", before: uniformOf(before, "channelId"), after: after.channelId }];
    case "moderation.setThreshold": {
      const previous = findBy(before, "violationType", after.violationType);
      return [
        { label: `${violationLabel(after.violationType)}の検知`, kind: "bool", before: previous?.enabled, after: after.enabled },
        {
          label: `${violationLabel(after.violationType)}の強度`,
          kind: "text",
          map: PRESET_LABELS,
          before: previous?.preset,
          after: after.preset,
        },
      ];
    }
    case "moderation.addToWhitelist":
    case "moderation.removeFromWhitelist":
      return [{ label: "対象", kind: after.targetType === "role" ? "role" : "user", after: after.targetId }];
    case "moderation.setEscalationPreset":
      return [{ label: "エスカレーションの強度", kind: "text", map: PRESET_LABELS, before, after: after.preset }];
    case "moderation.setAutoLockdownOnRaid":
      return [
        {
          label: "レイド検知時の自動ロックダウン",
          kind: "bool",
          before: isRecord(before) ? before.autoLockdownOnRaid : undefined,
          after: after.enabled,
        },
      ];
    case "moderation.setLockdownRequested":
      return [
        {
          label: "ロックダウン",
          kind: "bool",
          before: isRecord(before) ? before.requestedLocked : undefined,
          after: after.requestedLocked,
        },
      ];
    case "moderation.removeNgword":
      return [{ label: "NGワード", kind: "text", before: findBy(before, "id", after.id)?.pattern, after: "削除" }];
    case "tempVoice.clearConfig":
      return [
        { label: "作成用ボイスチャンネル", kind: "channel", before: isRecord(before) ? before.createChannelId : undefined, after: null },
        { label: "カテゴリ", kind: "channel", before: isRecord(before) ? before.categoryId : undefined, after: null },
      ];
    case "tempVoice.setDenyProtectedRoles":
      return [{ label: "拒否禁止ロール", kind: "roles", before: Array.isArray(before) ? before : undefined, after: after.roleIds }];
    case "scheduledPost.updateSettings":
      return [
        { label: "使えるロール", kind: "roles", before: isRecord(before) ? before.allowedRoleIds : undefined, after: after.roleIds },
        { label: "予約時に @everyone を指定できる", kind: "bool", before: isRecord(before) ? before.allowEveryone : undefined, after: after.allowEveryone },
        { label: "予約時に @here を指定できる", kind: "bool", before: isRecord(before) ? before.allowHere : undefined, after: after.allowHere },
      ];
    case "access.grantCapabilities":
    case "access.revokeCapabilityGrant":
      return [
        { label: "対象", kind: after.targetType === "role" ? "role" : "user", after: after.targetId },
        {
          label: "権限",
          kind: "capabilities",
          before: isRecord(before) ? before.capabilities : 0,
          after: key === "access.revokeCapabilityGrant" ? 0 : after.capabilities,
        },
      ];
    default:
      return null;
  }
}

/** 専用の取り出しがない操作用。after(送信内容)の各項目を、beforeの同じキーと比べる。 */
function genericRows(before: unknown, after: Record<string, unknown>): ChangeRow[] {
  const previous = isRecord(before) ? before : undefined;
  return Object.entries(after)
    .filter(([key]) => !HIDDEN_KEYS.has(key))
    .map(([key, value]) => {
      const meta = KEY_META[key] ?? { label: key, kind: "text" };
      // targetIdはtargetType(role/user)で名前の見せ方が変わる。
      const kind = key === "targetId" ? (after.targetType === "role" ? "role" : "user") : meta.kind;
      const label = key === "targetId" ? "対象" : meta.label;
      return {
        label,
        kind,
        map: meta.map,
        before: previous && key in previous ? previous[key] : undefined,
        after: value,
      } satisfies ChangeRow;
    });
}

/**
 * 操作履歴の変更内容を「項目名 変更前 → 変更後」の一覧にする。値が変わらなかった項目は除く。
 * 送信内容(after)の項目のみを対象にする(部分更新で送られなかった項目は変わっていないため)。
 */
export function describeChanges(
  feature: string,
  action: string,
  before: unknown,
  after: unknown,
  names: AuditNames,
): AuditChange[] {
  if (!isRecord(after)) return [];
  const rows = specificRows(`${feature}.${action}`, before, after) ?? genericRows(before, after);
  return rows.flatMap((row) => {
    if (row.kind === "capabilities") {
      const before0 = typeof row.before === "number" ? row.before : 0;
      const afterMask = typeof row.after === "number" ? row.after : 0;
      const text = describeCapabilityChange(before0, afterMask);
      return text === null ? [] : [{ label: row.label, after: text }];
    }
    if (row.before !== undefined && JSON.stringify(row.before) === JSON.stringify(row.after)) return [];
    return [
      {
        label: row.label,
        ...(row.before === undefined ? {} : { before: formatValue(row.kind, row.before, names, row.map) }),
        after: formatValue(row.kind, row.after, names, row.map),
      },
    ];
  });
}
