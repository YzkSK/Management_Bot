import { resolveEffectiveCapabilities, validateSession } from "@management-bot/dashboard-access";
import type { Db } from "@management-bot/db";
import { CAPABILITIES, hasCapability } from "@management-bot/shared";
import { createBunWebSocket } from "hono/bun";
import { Hono, type MiddlewareHandler } from "hono";
import type { WSContext } from "hono/ws";
import { getCookie } from "hono/cookie";
import { createGetGuildMembership } from "../context.js";
import { SESSION_COOKIE } from "../oauth/routes.js";
import { startAccessRevalidation } from "./access-revalidation.js";
import { activityClients } from "./activity-broadcaster.js";
import { createConnectionLimiter } from "./connection-limiter.js";
import { registerLogClient, unregisterLogClient } from "./log-broadcaster.js";

const { upgradeWebSocket, websocket } = createBunWebSocket();

const SESSION_EXPIRED_CLOSE_CODE = 4001;
/** 接続後にcapability剥奪・guild退出が判明したときのclose code(フロントは再接続しない)。 */
export const ACCESS_REVOKED_CLOSE_CODE = 4003;
const ACCESS_REVALIDATE_INTERVAL_MS = 30_000;
const ACCESS_REVALIDATE_JITTER_MS = 10_000;

/**
 * /ws/logs/:guildId(新規ログ)と /ws/activity/:guildId(アクティビティ変更)は通知のみ流すシンプルなプロトコル(本文はtRPCで取得させる)。
 * tRPCのrequireCapabilityと同じ認可条件(セッション有効 + 各capability)を、upgrade前のミドルウェアで検証する。
 * 検証をupgradeWebSocket自体の中で行わないのは、認可失敗時にWebSocket確立前の通常のHTTPエラー
 * (401/403)として返し、フロント側の再ログイン導線(isUnauthorizedError)と揃えるため。
 *
 * ponytail: capability剥奪やguild退出は、接続後30〜40秒ごとの再検証で反映する
 * (所属guild一覧の30秒キャッシュを経由するため、最大で1分強の遅延)。完全な即時反映が必要になったら、
 * 権限変更イベント発生時にlog-broadcaster側で該当guildの接続を明示的にcloseする経路を追加すること。
 */
interface WsVariables {
  sessionId: string;
  sessionExpiresAt: Date;
  discordUserId: string;
}

// 複数タブ×2エンドポイント(logs/activity)を想定したユーザー単位の上限と、プロセス全体の上限(issue #559)。
const MAX_CONNECTIONS_PER_USER = 10;
const MAX_CONNECTIONS_TOTAL = 1000;
const TRY_AGAIN_LATER_CLOSE_CODE = 1013;
/** クライアントからの受信は使わないため、受信サイズの上限を小さくする(Bun既定は16MB)。 */
export const WS_MAX_PAYLOAD_LENGTH = 1024;

export function createWsRoutes(
  db: Db,
  sessionSecret: string,
  botToken: string,
  dashboardWebUrl: string,
): { app: Hono<{ Variables: WsVariables }>; websocket: typeof websocket } {
  const app = new Hono<{ Variables: WsVariables }>();
  const expectedOrigin = new URL(dashboardWebUrl).origin;
  const connectionLimiter = createConnectionLimiter({
    perUser: MAX_CONNECTIONS_PER_USER,
    total: MAX_CONNECTIONS_TOTAL,
  });

  // upgrade時の認可と接続後の定期再検証で共用する。メンバーシップは共有キャッシュ経由で引く。
  const checkAccess = async (
    sessionId: string | undefined,
    guildId: string,
    capability: number,
  ): Promise<{ ok: true; session: { expiresAt: Date; discordUserId: string } } | { ok: false; status: 401 | 403 }> => {
    const session = sessionId ? await validateSession(db, sessionId) : null;
    if (!session) {
      return { ok: false, status: 401 };
    }
    const membership = await createGetGuildMembership(db, sessionId, sessionSecret, botToken)(
      guildId,
      session.discordUserId,
    );
    if (!membership) {
      return { ok: false, status: 403 };
    }
    const capabilities = await resolveEffectiveCapabilities(db, {
      guildId,
      discordUserId: session.discordUserId,
      isOwner: membership.isOwner,
      roleIds: membership.roleIds,
    });
    if (!hasCapability(capabilities, capability)) {
      return { ok: false, status: 403 };
    }
    return { ok: true, session };
  };

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
      const result = await checkAccess(sessionId, guildId, capability);
      if (!result.ok) {
        return result.status === 401 ? c.text("Unauthorized", 401) : c.text("Forbidden", 403);
      }
      // checkAccessが成功した時点でsessionIdはundefinedではない。
      if (sessionId === undefined) {
        return c.text("Unauthorized", 401);
      }
      c.set("sessionId", sessionId);
      c.set("sessionExpiresAt", result.session.expiresAt);
      c.set("discordUserId", result.session.discordUserId);
      return next();
    };

  const upgrade = (
    capability: number,
    register: (guildId: string, ws: WSContext) => void,
    unregister: (guildId: string, ws: WSContext) => void,
  ) =>
    upgradeWebSocket((c) => {
      const guildId = c.req.param("guildId");
      const sessionId = c.get("sessionId");
      const sessionExpiresAt = c.get("sessionExpiresAt");
      const discordUserId = c.get("discordUserId");
      let expiryTimer: ReturnType<typeof setTimeout> | undefined;
      let stopRevalidation: (() => void) | undefined;
      let acquired = false;

      return {
        onOpen(_event, ws) {
          if (!guildId) return;
          if (!connectionLimiter.tryAcquire(discordUserId)) {
            ws.close(TRY_AGAIN_LATER_CLOSE_CODE, "too many connections");
            return;
          }
          acquired = true;
          register(guildId, ws);
          // セッション失効後もWebSocket自体は生き続けてしまうため、有効期限で強制切断する。
          expiryTimer = setTimeout(
            () => ws.close(SESSION_EXPIRED_CLOSE_CODE, "session expired"),
            Math.max(0, sessionExpiresAt.getTime() - Date.now()),
          );
          // 接続後のcapability剥奪・guild退出を反映するため、定期的に認可を再検証する。
          stopRevalidation ??= startAccessRevalidation(
            async () => {
              const result = await checkAccess(sessionId, guildId, capability);
              if (result.ok) return null;
              return result.status === 401 ? SESSION_EXPIRED_CLOSE_CODE : ACCESS_REVOKED_CLOSE_CODE;
            },
            (code, reason) => ws.close(code, reason),
            // デプロイ直後等に一斉接続した全接続が同時に再検証しないよう、接続ごとに間隔をずらす。
            ACCESS_REVALIDATE_INTERVAL_MS + Math.floor(Math.random() * ACCESS_REVALIDATE_JITTER_MS),
          );
        },
        onClose(_event, ws) {
          if (expiryTimer) clearTimeout(expiryTimer);
          stopRevalidation?.();
          if (!acquired) return;
          connectionLimiter.release(discordUserId);
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
  app.get("/logs/:guildId", authorize(CAPABILITIES.VIEW_LOGS), upgrade(CAPABILITIES.VIEW_LOGS, registerLogClient, unregisterLogClient));
  app.get(
    "/activity/:guildId",
    authorize(CAPABILITIES.VIEW_ACTIVITY),
    upgrade(CAPABILITIES.VIEW_ACTIVITY, activityClients.register, activityClients.unregister),
  );

  return { app, websocket };
}
