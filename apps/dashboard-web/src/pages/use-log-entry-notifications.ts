import { useEffect, useRef, useState } from "react";
import { API_URL } from "../trpc.js";
import { buildLogWsUrl, nextReconnectDelayMs, parseLogNotificationMessage } from "./log-notifications.js";

export type LogNotificationConnectionStatus = "connecting" | "open" | "closed";

/**
 * /ws/logs/:guildIdへ接続し、新規ログ発生の通知を受けるたびonNewEntry(category)を呼ぶ。
 * 切断時は指数バックオフで自動再接続する(nextReconnectDelayMs)。
 */
export function useLogEntryNotifications(
  guildId: string,
  onNewEntry: (category: string) => void,
): LogNotificationConnectionStatus {
  const [status, setStatus] = useState<LogNotificationConnectionStatus>("connecting");
  const onNewEntryRef = useRef(onNewEntry);
  onNewEntryRef.current = onNewEntry;

  useEffect(() => {
    let cancelled = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;

    const connect = () => {
      if (cancelled) return;
      setStatus("connecting");
      socket = new WebSocket(buildLogWsUrl(API_URL, guildId));

      socket.onopen = () => {
        attempt = 0;
        setStatus("open");
      };
      socket.onmessage = (event) => {
        const notification = typeof event.data === "string" ? parseLogNotificationMessage(event.data) : null;
        if (notification) {
          onNewEntryRef.current(notification.category);
        }
      };
      socket.onclose = () => {
        if (cancelled) return;
        setStatus("closed");
        attempt += 1;
        reconnectTimer = setTimeout(connect, nextReconnectDelayMs(attempt));
      };
      socket.onerror = () => {
        socket?.close();
      };
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      socket?.close();
    };
  }, [guildId]);

  return status;
}
