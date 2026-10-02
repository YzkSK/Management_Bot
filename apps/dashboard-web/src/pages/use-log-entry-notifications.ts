import { API_URL } from "../trpc.js";
import { buildGuildWsUrl, parseLogNotificationMessage } from "./log-notifications.js";
import { type LogNotificationConnectionStatus, useGuildWs } from "./use-guild-ws.js";

export type { LogNotificationConnectionStatus } from "./use-guild-ws.js";

/** /ws/logs/:guildIdへ接続し、新規ログ発生の通知を受けるたびonNewEntry(category)を呼ぶ。 */
export function useLogEntryNotifications(
  guildId: string,
  onNewEntry: (category: string) => void,
): LogNotificationConnectionStatus {
  return useGuildWs(buildGuildWsUrl(API_URL, "logs", guildId), (data) => {
    const notification = parseLogNotificationMessage(data);
    if (notification) {
      onNewEntry(notification.category);
    }
  });
}
