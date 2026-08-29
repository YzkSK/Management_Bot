import type { DashboardAccessContext, GuildMembership } from "@management-bot/dashboard-access";
import type { Db } from "@management-bot/db";
import type { Context as HonoContext } from "hono";
import { getCookie } from "hono/cookie";
import { SESSION_COOKIE } from "./oauth/routes.js";

/**
 * ギルド在籍確認はDiscord Gateway/APIキャッシュ(bot側)への問い合わせが必要だが、
 * そのRedis/RPC連携はPhase 1以降で機能パッケージと一緒に配線する。
 * Phase 0時点ではダッシュボードapp-routerが空のため実際には呼ばれないが、
 * 未在籍として扱う(null)ことでrequireCapabilityがFORBIDDENに倒すようにし、500化を防ぐ。
 */
async function getGuildMembershipNotImplemented(): Promise<GuildMembership | null> {
  return null;
}

/**
 * `@hono/trpc-server`のcreateContext型は`Record<string, unknown>`を要求するが、
 * 実際にはinitTRPC.context<DashboardAccessContext>()で定義した型がそのままprocedureに渡る。
 * ここでの型注釈はtRPC側の実際の契約(DashboardAccessContext)を守るための意図的なもの。
 */
export function createContext(
  db: Db,
): (opts: unknown, c: HonoContext) => Record<string, unknown> {
  return (_opts, c) => {
    const ctx: DashboardAccessContext = {
      db,
      sessionId: getCookie(c, SESSION_COOKIE),
      getGuildMembership: getGuildMembershipNotImplemented,
    };
    return ctx as unknown as Record<string, unknown>;
  };
}
