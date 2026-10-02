import { resolveEffectiveCapabilities, validateSession } from "@management-bot/dashboard-access";
import type { Db } from "@management-bot/db";
import { CAPABILITIES, hasCapability } from "@management-bot/shared";
import { createBunWebSocket } from "hono/bun";
import { Hono, type MiddlewareHandler } from "hono";
import type { WSContext } from "hono/ws";
import { getCookie } from "hono/cookie";
import { resolveGuildMembership } from "../context.js";
import { SESSION_COOKIE } from "../oauth/routes.js";
import { activityClients } from "./activity-broadcaster.js";
import { registerLogClient, unregisterLogClient } from "./log-broadcaster.js";

const { upgradeWebSocket, websocket } = createBunWebSocket();

const SESSION_EXPIRED_CLOSE_CODE = 4001;

/**
 * /ws/logs/:guildId(新規ログ)と /ws/activity/:guildId(アクティビティ変更)は通知のみ流すシンプルなプロトコル(本文はtRPCで取得させる)。
 * tRPCのrequireCapabilityと同じ認可条件(セッション有効 + 各capability)を、upgrade前のミドルウェアで検証する。
 * 検証をupgradeWebSocket自体の中で行わないのは、認可失敗時にWebSocket確立前の通常のHTTPエラー
 * (401/403)として返し、フロント側の再ログイン導線(isUnauthorizedError)と揃えるため。
 *
 * ponytail: capability剥奪やguild退出はセッション有効期限までは反映されない(接続時点でのみ検証)。
 * 即時反映が必要になったら、権限変更イベント発生時にlog-broadcaster側で該当guildの接続を
 * 明示的にcloseする経路を追加すること。
 */
interface WsVariables {
  sessionExpiresAt: Date;
}

export function createWsRoutes(
  db: Db,
  sessionSecret: string,
  botToken: string,
  dashboardWebUrl: string,
): { app: Hono<{ Variables: WsVariables }>; websocket: typeof websocket } {
  const app = new Hono<{ Variables: WsVariables }>();
  const expectedOrigin = new URL(dashboardWebUrl).origin;

  const authorize =
    (capability: number): MiddlewareHandler<{ Variables: WsVariables }> =>
    async (c, next) => {
      // Cookieのみでの認証はCORSの保護対象外(WebSocketにCORSは適用されない)のため、
      // Origin検証でCross-Site WebSocket Hijackingを防ぐ。
      if (c.req.header("Origin") !== expectedOrigin) {
        return c.text("Forbidden", 403);
      }

      const guildId = c.req.param("guildId");
      if (!guildId) {
        return c.text("Not Found", 404);
      }
      const sessionId = getCookie(c, SESSION_COOKIE);
      const session = sessionId ? await validateSession(db, sessionId) : null;
      if (!session) {
        return c.text("Unauthorized", 401);
      }

      const membership = await resolveGuildMembership(
        db,
        sessionId,
        sessionSecret,
        botToken,
        guildId,
        session.discordUserId,
      );
      if (!membership) {
        return c.text("Forbidden", 403);
      }

      const capabilities = await resolveEffectiveCapabilities(db, {
        guildId,
        discordUserId: session.discordUserId,
        isOwner: membership.isOwner,
        roleIds: membership.roleIds,
      });
      if (!hasCapability(capabilities, capability)) {
        return c.text("Forbidden", 403);
      }
      c.set("sessionExpiresAt", session.expiresAt);
      return next();
    };

  const upgrade = (register: (guildId: string, ws: WSContext) => void, unregister: (guildId: string, ws: WSContext) => void) =>
    upgradeWebSocket((c) => {
      const guildId = c.req.param("guildId");
      const sessionExpiresAt = c.get("sessionExpiresAt");
      let expiryTimer: ReturnType<typeof setTimeout> | undefined;

      return {
        onOpen(_event, ws) {
          if (!guildId) return;
          register(guildId, ws);
          // セッション失効後もWebSocket自体は生き続けてしまうため、有効期限で強制切断する。
          expiryTimer = setTimeout(
            () => ws.close(SESSION_EXPIRED_CLOSE_CODE, "session expired"),
            Math.max(0, sessionExpiresAt.getTime() - Date.now()),
          );
        },
        onClose(_event, ws) {
          if (expiryTimer) clearTimeout(expiryTimer);
          if (guildId) unregister(guildId, ws);
        },
      };
    });

  /**
   * ここではVIEW_LOGSのみをチェックしている。これは「新規ログ発生の通知のみ流し、
   * 本文はtRPCで取得させる」設計だから問題ない(WSペイロードにログ本文やchanges等の
   * プレビューを含めていない)。将来WSペイロードに本文相当の情報を追加する場合は、
   * 必ずVIEW_LOGS_RAWのチェックも追加すること。忘れるとVIEW_LOGS-onlyのユーザーに
   * WebSocket経由で生データが漏れる(issue #220)。
   */
  app.get("/logs/:guildId", authorize(CAPABILITIES.VIEW_LOGS), upgrade(registerLogClient, unregisterLogClient));
  app.get("/activity/:guildId", authorize(CAPABILITIES.VIEW_ACTIVITY), upgrade(activityClients.register, activityClients.unregister));

  return { app, websocket };
}
