import type { WSContext } from "hono/ws";

const clientsByGuild = new Map<string, Set<WSContext>>();

export function registerLogClient(guildId: string, ws: WSContext): void {
  let clients = clientsByGuild.get(guildId);
  if (!clients) {
    clients = new Set();
    clientsByGuild.set(guildId, clients);
  }
  clients.add(ws);
}

export function unregisterLogClient(guildId: string, ws: WSContext): void {
  const clients = clientsByGuild.get(guildId);
  if (!clients) return;
  clients.delete(ws);
  if (clients.size === 0) {
    clientsByGuild.delete(guildId);
  }
}

/** そのguildIdのログ一覧画面を開いている全クライアントへ新規ログの発生を知らせる(本文は含まない、通知を受けてtRPC経由で再取得させる)。 */
export function broadcastNewLogEntry(guildId: string, category: string): void {
  const clients = clientsByGuild.get(guildId);
  if (!clients || clients.size === 0) return;
  const message = JSON.stringify({ type: "newLogEntry", category });
  for (const ws of clients) {
    ws.send(message);
  }
}
