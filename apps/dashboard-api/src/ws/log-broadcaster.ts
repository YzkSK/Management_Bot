import type { WSContext } from "hono/ws";

// 接続数の上限・バックプレッシャー制御は現状の規模では不要と判断している。
// 導入の判断基準と方針は docs/architecture/07-websocket-connection-limits.md を参照(#424)。

export interface GuildBroadcaster {
  register(guildId: string, ws: WSContext): void;
  unregister(guildId: string, ws: WSContext): void;
  broadcast(guildId: string, message: string): void;
}

/** guildIdごとに接続中のクライアントを持ち、通知を配る(本文は含めず、通知を受けてtRPC経由で再取得させる)。 */
export function createGuildBroadcaster(label: string): GuildBroadcaster {
  const clientsByGuild = new Map<string, Set<WSContext>>();

  const unregister = (guildId: string, ws: WSContext): void => {
    const clients = clientsByGuild.get(guildId);
    if (!clients) return;
    clients.delete(ws);
    if (clients.size === 0) {
      clientsByGuild.delete(guildId);
    }
  };

  return {
    register(guildId, ws) {
      let clients = clientsByGuild.get(guildId);
      if (!clients) {
        clients = new Set();
        clientsByGuild.set(guildId, clients);
      }
      clients.add(ws);
    },
    unregister,
    broadcast(guildId, message) {
      const clients = clientsByGuild.get(guildId);
      if (!clients || clients.size === 0) return;
      // 1クライアントへのsend失敗(既に切断済みのsocket等)で残りのクライアントへの配信が
      // 止まらないよう、クライアントごとに例外を隔離する。
      for (const ws of [...clients]) {
        try {
          ws.send(message);
        } catch (error) {
          console.error(`Failed to send ${label} notification to a client of guild ${guildId}`, error);
          unregister(guildId, ws);
        }
      }
    },
  };
}

const logClients = createGuildBroadcaster("log");

export const registerLogClient = logClients.register;
export const unregisterLogClient = logClients.unregister;

/** そのguildIdのログ一覧画面を開いている全クライアントへ新規ログの発生を知らせる。 */
export function broadcastNewLogEntry(guildId: string, category: string): void {
  logClients.broadcast(guildId, JSON.stringify({ type: "newLogEntry", category }));
}
