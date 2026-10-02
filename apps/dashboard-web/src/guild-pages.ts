import { useQuery } from "@tanstack/react-query";
import { CAPABILITIES, FEATURE_METADATA, hasCapability } from "@management-bot/shared";
import { trpc } from "./trpc.js";

/** ページ実装済みの機能のみここに登録する(未実装の機能はリンクにしない)。 */
const FEATURE_PATHS: Record<string, string> = {
  activity: "activity",
  logging: "logs",
  moderation: "moderation",
  "temp-voice": "temp-voice",
};

export interface GuildPage {
  key: string;
  name: string;
  /** `/guilds/:guildId/`以下のパス。 */
  path: string;
  /** ページを閲覧するのに必要なcapability。 */
  capability: number;
}

/** サイドバーの表示順かつ、サーバー選択後の遷移先の優先順。 */
export const GUILD_PAGES: readonly GuildPage[] = [
  ...FEATURE_METADATA.flatMap((feature) => {
    const path = FEATURE_PATHS[feature.key];
    return path ? [{ key: feature.key, name: feature.name, path, capability: feature.viewCapability }] : [];
  }),
  { key: "access", name: "アクセス権限", path: "access", capability: CAPABILITIES.MANAGE_ACCESS },
];

export function guildPagePath(guildId: string, page: GuildPage): string {
  return `/guilds/${guildId}/${page.path}`;
}

/** 閲覧可能な最初のページのパス。1つも閲覧できなければnull(issue #527)。 */
export function firstAccessiblePath(guildId: string, capabilities: number): string | null {
  const page = GUILD_PAGES.find((p) => hasCapability(capabilities, p.capability));
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
