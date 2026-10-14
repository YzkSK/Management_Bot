import type { DashboardAccessContext } from "./trpc.js";

/** before/afterでDiscord IDを1件持つキー。`guildId`は識別用でUIに出さないため含めない。 */
const SINGLE_ID_KEYS: ReadonlySet<string> = new Set([
  "channelId",
  "createChannelId",
  "categoryId",
  "roleId",
  "targetId",
  "userId",
  "ownerId",
]);
/** before/afterでDiscord IDの配列を持つキー。 */
const ID_LIST_KEYS: ReadonlySet<string> = new Set(["roleIds", "channelIds", "userIds", "allowedRoleIds"]);

const SNOWFLAKE = /^\d{17,20}$/;
/** 1ページ(最大100件)の表示で名前解決するメンバーの上限。Discord APIへの問い合わせ過多を避ける。 */
const MAX_MEMBER_LOOKUPS = 100;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function walk(value: unknown, ids: Set<string>): void {
  if (Array.isArray(value)) {
    // 一時VCの拒否禁止ロールなど、キー無しでID配列そのものを保存している変更前の値。
    for (const item of value) {
      if (typeof item === "string" && SNOWFLAKE.test(item)) ids.add(item);
      else walk(item, ids);
    }
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (SINGLE_ID_KEYS.has(key) && typeof child === "string") {
      if (SNOWFLAKE.test(child)) ids.add(child);
    } else if (ID_LIST_KEYS.has(key) && Array.isArray(child)) {
      for (const item of child) {
        if (typeof item === "string" && SNOWFLAKE.test(item)) ids.add(item);
      }
    } else {
      walk(child, ids);
    }
  }
}

/** 操作履歴のbefore/afterに含まれるDiscord ID(チャンネル・ロール・ユーザー)を重複なく集める。 */
export function collectAuditIds(values: readonly unknown[]): string[] {
  const ids = new Set<string>();
  for (const value of values) walk(value, ids);
  return [...ids];
}

type NameResolverContext = Pick<DashboardAccessContext, "getAllGuildChannels" | "getGuildRoles" | "getGuildMemberNames">;

/**
 * IDを名前に解決する(チャンネル→ロール→メンバーの順)。解決できなかったIDは含めない
 * (UIがIDのまま表示する)。表示補助のため、取得に失敗しても履歴一覧自体は返せるよう例外は握りつぶす。
 */
export async function resolveAuditNames(
  ctx: NameResolverContext,
  guildId: string,
  ids: readonly string[],
): Promise<Record<string, string>> {
  if (ids.length === 0) return {};
  const wanted = new Set(ids);
  const names: Record<string, string> = {};

  const [channels, roles] = await Promise.all([
    ctx.getAllGuildChannels(guildId).catch(() => []),
    ctx.getGuildRoles(guildId).catch(() => []),
  ]);
  for (const option of [...channels, ...roles]) {
    if (wanted.has(option.id)) names[option.id] = option.name;
  }

  const rest = ids.filter((id) => !(id in names)).slice(0, MAX_MEMBER_LOOKUPS);
  if (rest.length > 0) {
    try {
      for (const [id, name] of await ctx.getGuildMemberNames(guildId, rest)) names[id] = name;
    } catch {
      // メンバー名を解決できなければIDのまま表示する。
    }
  }
  return names;
}
