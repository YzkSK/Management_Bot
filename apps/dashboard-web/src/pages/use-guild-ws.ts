import { useEffect, useRef, useState } from "react";
import { nextReconnectDelayMs } from "./log-notifications.js";

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
 * dashboard-apiの通知用WebSocket(/ws/logs, /ws/activity)へ接続し、文字列メッセージごとにonMessageを呼ぶ。
 * 接続・再接続のたびにonOpenを呼ぶ(切断中の取りこぼしを呼び出し元が取り直せるように)。
 * 切断時はjitter付き指数バックオフで自動再接続するが、セッション失効通知(close code 4001)を
 * 受けた場合や規定回数失敗した場合は諦め、呼び出し元がリロード/再ログインを促せるようにする。
 * urlが空文字なら接続しない。
 */
export function useGuildWs(
  url: string,
  onMessage: (data: string) => void,
  onOpen?: () => void,
): LogNotificationConnectionStatus {
  const [status, setStatus] = useState<LogNotificationConnectionStatus>("connecting");
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;

  useEffect(() => {
    if (url === "") return;
    let cancelled = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;

    const connect = () => {
      if (cancelled) return;
      setStatus("connecting");
      socket = new WebSocket(url);

      socket.onopen = () => {
        attempt = 0;
        setStatus("open");
        onOpenRef.current?.();
      };
      socket.onmessage = (event) => {
        if (typeof event.data === "string") onMessageRef.current(event.data);
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
  }, [url]);

  return status;
}
