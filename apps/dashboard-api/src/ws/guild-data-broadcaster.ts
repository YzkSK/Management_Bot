import { GUILD_DATA_TOPIC_CAPABILITY, type GuildDataTopic, hasCapability } from "@management-bot/shared";
import type { WSContext } from "hono/ws";

/** /ws/guild/:guildId の接続。capabilitiesは接続時と定期再検証のたびに更新される。 */
export interface GuildDataClient {
  ws: WSContext;
  capabilities: number;
}

export interface GuildDataBroadcaster {
  register(guildId: string, client: GuildDataClient): void;
  unregister(guildId: string, client: GuildDataClient): void;
  broadcast(guildId: string, topic: GuildDataTopic): void;
}

/**
 * guildごとの接続に、topicの通知(本文なし)を配る。保持中のcapabilitiesでそのtopicを見られる
 * クライアントにだけ送る。
 */
export function createGuildDataBroadcaster(): GuildDataBroadcaster {
  const clientsByGuild = new Map<string, Set<GuildDataClient>>();

  const unregister = (guildId: string, client: GuildDataClient): void => {
    const clients = clientsByGuild.get(guildId);
    if (!clients) return;
    clients.delete(client);
    if (clients.size === 0) clientsByGuild.delete(guildId);
  };

  return {
    register(guildId, client) {
      let clients = clientsByGuild.get(guildId);
      if (!clients) {
        clients = new Set();
        clientsByGuild.set(guildId, clients);
      }
      clients.add(client);
    },
    unregister,
    broadcast(guildId, topic) {
      const clients = clientsByGuild.get(guildId);
      if (!clients) return;
      const message = JSON.stringify({ type: "changed", topic });
      const required = GUILD_DATA_TOPIC_CAPABILITY[topic];
      for (const client of [...clients]) {
        if (!hasCapability(client.capabilities, required)) continue;
        // 1クライアントのsend失敗(切断済みsocket等)で残りへの配信を止めない。
        try {
          client.ws.send(message);
        } catch (error) {
          console.error(`Failed to send guild data notification to a client of guild ${guildId}`, error);
          unregister(guildId, client);
        }
      }
    },
  };
}

export const guildDataClients = createGuildDataBroadcaster();
