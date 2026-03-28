import { useEffect, useRef, useState, useCallback } from "react";
import type { WsStatus, WsMessage } from "../types";

const BACKOFF_MS = [250, 500, 1000, 2000] as const;

export function useWebSocket(projectId: string | null) {
  const [status, setStatus] = useState<WsStatus>("connecting");
  const [lastMessage, setLastMessage] = useState<WsMessage | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoffIndexRef = useRef(0);
  const unmountedRef = useRef(false);

  const connect = useCallback(() => {
    if (!projectId || unmountedRef.current) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    const ws = new WebSocket(wsUrl);
    socketRef.current = ws;
    setStatus("connecting");

    ws.onopen = () => {
      if (unmountedRef.current) { ws.close(); return; }
      setStatus("open");
      backoffIndexRef.current = 0;
      ws.send(JSON.stringify({ type: "subscribe", projectId }));
    };

    ws.onmessage = (e: MessageEvent) => {
      if (unmountedRef.current) return;
      try {
        const msg = JSON.parse(e.data as string) as WsMessage;
        if (msg.type) setLastMessage(msg);
      } catch {
        // Ignore non-JSON or legacy event messages
      }
    };

    const scheduleReconnect = () => {
      if (unmountedRef.current) return;
      setStatus("reconnecting");
      const delay = BACKOFF_MS[Math.min(backoffIndexRef.current, BACKOFF_MS.length - 1)];
      backoffIndexRef.current = Math.min(backoffIndexRef.current + 1, BACKOFF_MS.length - 1);
      reconnectTimerRef.current = setTimeout(connect, delay);
    };

    ws.onclose = scheduleReconnect;
    ws.onerror = scheduleReconnect;
  }, [projectId]);

  useEffect(() => {
    unmountedRef.current = false;
    connect();

    return () => {
      unmountedRef.current = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [connect]);

  const send = useCallback((msg: unknown) => {
    if (status === "open" && socketRef.current) {
      socketRef.current.send(JSON.stringify(msg));
    }
  }, [status]);

  return { status, lastMessage, send };
}
