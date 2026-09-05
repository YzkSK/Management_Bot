import { useEffect, useRef, useState } from "react";
import { API_URL } from "../trpc.js";
import { buildLogWsUrl, nextReconnectDelayMs, parseLogNotificationMessage } from "./log-notifications.js";

/**
 * connecting: 接続試行中
 * open: 接続済み
 * reconnecting: 切断され、バックオフの上で再接続を試みている
 * stopped: セッション失効、または再接続を規定回数試みても失敗したため諦めた(要リロード/再ログイン)
 */
export type LogNotificationConnectionStatus = "connecting" | "open" | "reconnecting" | "stopped";

/** dashboard-api側(ws/routes.ts)がセッション失効時に使うclose code。 */
const SESSION_EXPIRED_CLOSE_CODE = 4001;
/** この回数連続で接続に失敗したら諦める(無期限リトライで401/403を叩き続けるのを防ぐ)。 */
const MAX_RECONNECT_ATTEMPTS = 6;

/**
 * /ws/logs/:guildIdへ接続し、新規ログ発生の通知を受けるたびonNewEntry(category)を呼ぶ。
 * 切断時はjitter付き指数バックオフで自動再接続するが、セッション失効通知(close code 4001)を
 * 受けた場合や規定回数失敗した場合は諦め、呼び出し元がリロード/再ログインを促せるようにする。
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
      socket.onclose = (event) => {
        if (cancelled) return;
        if (event.code === SESSION_EXPIRED_CLOSE_CODE) {
          setStatus("stopped");
          return;
        }
        attempt += 1;
        if (attempt >= MAX_RECONNECT_ATTEMPTS) {
          setStatus("stopped");
          return;
        }
        setStatus("reconnecting");
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
