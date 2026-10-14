import { useQuery } from "@tanstack/react-query";
import { CAPABILITIES, FEATURE_METADATA, hasCapability } from "@management-bot/shared";
import { trpc } from "./trpc.js";

/** ページ実装済みの機能のみここに登録する(未実装の機能はリンクにしない)。 */
const FEATURE_PATHS: Record<string, string> = {
  activity: "activity",
  logging: "logs",
  moderation: "moderation",
  "scheduled-post": "scheduled-post",
  "temp-voice": "temp-voice",
};

export interface GuildPage {
  key: string;
  name: string;
  /** `/guilds/:guildId/`以下のパス。 */
  path: string;
  /** ページを閲覧するのに必要なcapability。0はギルドメンバーなら誰でも(自分のデータのみ表示するページ)。 */
  capability: number;
}

/** サイドバーの表示順かつ、サーバー選択後の遷移先の優先順。 */
export const GUILD_PAGES: readonly GuildPage[] = [
  ...FEATURE_METADATA.flatMap((feature) => {
    const path = FEATURE_PATHS[feature.key];
    // 予約投稿・一時VCは閲覧権限がなくても全メンバーに表示する(権限がなければ自分の予約・自分がオーナーのVCのみ。APIが絞る)。
    const capability = feature.key === "scheduled-post" || feature.key === "temp-voice" ? 0 : feature.viewCapability;
    return path ? [{ key: feature.key, name: feature.name, path, capability }] : [];
  }),
  { key: "roles", name: "ロール管理", path: "roles", capability: CAPABILITIES.VIEW_ROLES },
  { key: "access", name: "アクセス権限", path: "access", capability: CAPABILITIES.MANAGE_ACCESS },
  { key: "audit-log", name: "操作履歴", path: "audit-log", capability: CAPABILITIES.VIEW_AUDIT_LOG },
];

export function guildPagePath(guildId: string, page: GuildPage): string {
  return `/guilds/${guildId}/${page.path}`;
}

/**
 * 閲覧可能な最初のページのパス(issue #527)。権限で開けるページを優先し、無ければ全メンバー向け(capability 0)の
 * ページ(予約投稿の自分の分など)へ遷移する。全メンバー向けページも無ければnull。
 */
export function firstAccessiblePath(guildId: string, capabilities: number): string | null {
  const page =
    GUILD_PAGES.find((p) => p.capability !== 0 && hasCapability(capabilities, p.capability)) ??
    GUILD_PAGES.find((p) => p.capability === 0);
  return page ? guildPagePath(guildId, page) : null;
}

/**
 * ログインユーザーのこのguildでの実効capabilities。取得中はundefined。
 * 表示の出し分け専用で、認可はAPI側のrequireCapabilityが強制する。
 */
export function useGuildCapabilities(guildId: string | undefined): number | undefined {
  const guildsQuery = useQuery(trpc.guildSettings.listMyGuilds.queryOptions());
  if (!guildsQuery.data) return undefined;
  return guildsQuery.data.find((g) => g.id === guildId)?.capabilities ?? 0;
}
