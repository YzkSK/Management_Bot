import { resolveEffectiveCapabilities, validateSession } from "@management-bot/dashboard-access";
import type { Db } from "@management-bot/db";
import { CAPABILITIES, hasCapability } from "@management-bot/shared";
import { createBunWebSocket } from "hono/bun";
import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { resolveGuildMembership } from "../context.js";
import { SESSION_COOKIE } from "../oauth/routes.js";
import { registerLogClient, unregisterLogClient } from "./log-broadcaster.js";

const { upgradeWebSocket, websocket } = createBunWebSocket();

/**
 * /ws/logs/:guildId は新規ログ発生の通知のみ流すシンプルなプロトコル(本文はtRPCで取得させる)。
 * tRPCのrequireCapabilityと同じ認可条件(セッション有効 + VIEW_LOGS)を、upgrade前のミドルウェアで検証する。
 * 検証をupgradeWebSocket自体の中で行わないのは、認可失敗時にWebSocket確立前の通常のHTTPエラー
 * (401/403)として返し、フロント側の再ログイン導線(isUnauthorizedError)と揃えるため。
 */
export function createLogWsRoutes(db: Db, sessionSecret: string): { app: Hono; websocket: typeof websocket } {
  const app = new Hono();

  app.get(
    "/logs/:guildId",
    async (c, next) => {
      const guildId = c.req.param("guildId");
      const sessionId = getCookie(c, SESSION_COOKIE);
      const session = sessionId ? await validateSession(db, sessionId) : null;
      if (!session) {
        return c.text("Unauthorized", 401);
      }

      const membership = await resolveGuildMembership(db, sessionId, sessionSecret, guildId);
      if (!membership) {
        return c.text("Forbidden", 403);
      }

      const capabilities = await resolveEffectiveCapabilities(db, {
        guildId,
        discordUserId: session.discordUserId,
        isOwner: membership.isOwner,
        roleIds: membership.roleIds,
      });
      if (!hasCapability(capabilities, CAPABILITIES.VIEW_LOGS)) {
        return c.text("Forbidden", 403);
      }

      return next();
    },
    upgradeWebSocket((c) => {
      const guildId = c.req.param("guildId");
      return {
        onOpen(_event, ws) {
          if (guildId) registerLogClient(guildId, ws);
        },
        onClose(_event, ws) {
          if (guildId) unregisterLogClient(guildId, ws);
        },
      };
    }),
  );

  return { app, websocket };
}
