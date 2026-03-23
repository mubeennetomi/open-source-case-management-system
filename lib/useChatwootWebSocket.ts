"use client";

import { useEffect, useRef, useState, useCallback } from "react";

interface WebSocketCallbacks {
  onMessageCreated: (data: any) => void;
  onMessageUpdated: (data: any) => void;
  onConversationCreated: (data: any) => void;
  onConversationStatusChanged: (data: any) => void;
  onConversationUpdated: (data: any) => void;
}

const MAX_BACKOFF = 30_000;
const PING_TIMEOUT = 20_000;

export function useChatwootWebSocket(
  pubsubToken: string | null,
  accountId: number | null,
  userId: number | null,
  wsUrl: string,
  callbacks: WebSocketCallbacks
): { connected: boolean } {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const backoffRef = useRef(1000);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  const resetPingTimer = useCallback(() => {
    if (pingTimerRef.current) clearTimeout(pingTimerRef.current);
    pingTimerRef.current = setTimeout(() => {
      console.log("[ws] No ping received in 20s, forcing reconnect");
      wsRef.current?.close();
    }, PING_TIMEOUT);
  }, []);

  const clearTimers = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (pingTimerRef.current) {
      clearTimeout(pingTimerRef.current);
      pingTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!pubsubToken || !accountId || !userId) return;

    function connect() {
      clearTimers();

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log("[ws] Connected to", wsUrl);
        resetPingTimer();
      };

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);

        if (data.type === "welcome") {
          console.log("[ws] Received welcome, subscribing...");
          const identifier = JSON.stringify({
            channel: "RoomChannel",
            pubsub_token: pubsubToken,
            account_id: accountId,
            user_id: userId,
          });
          ws.send(JSON.stringify({ command: "subscribe", identifier }));
          return;
        }

        if (data.type === "confirm_subscription") {
          console.log("[ws] Subscription confirmed");
          setConnected(true);
          backoffRef.current = 1000;
          resetPingTimer();
          return;
        }

        if (data.type === "ping") {
          resetPingTimer();
          return;
        }

        if (data.type === "disconnect") {
          console.log("[ws] Server disconnected:", data.reason);
          return;
        }

        // Event messages
        if (data.message) {
          const eventName = data.message.event;
          const payload = data.message.data;

          switch (eventName) {
            case "message.created":
              callbacksRef.current.onMessageCreated(payload);
              break;
            case "message.updated":
              callbacksRef.current.onMessageUpdated(payload);
              break;
            case "conversation.created":
              callbacksRef.current.onConversationCreated(payload);
              break;
            case "conversation.status_changed":
              callbacksRef.current.onConversationStatusChanged(payload);
              break;
            case "conversation.updated":
            case "assignee.changed":
              callbacksRef.current.onConversationUpdated(payload);
              break;
            default:
              break;
          }
        }
      };

      ws.onclose = () => {
        console.log("[ws] Connection closed, reconnecting in", backoffRef.current, "ms");
        setConnected(false);
        clearTimers();
        reconnectTimerRef.current = setTimeout(() => {
          backoffRef.current = Math.min(backoffRef.current * 2, MAX_BACKOFF);
          connect();
        }, backoffRef.current);
      };

      ws.onerror = (err) => {
        console.error("[ws] Error:", err);
        ws.close();
      };
    }

    connect();

    return () => {
      clearTimers();
      if (wsRef.current) {
        wsRef.current.onclose = null; // prevent reconnect on intentional close
        wsRef.current.close();
        wsRef.current = null;
      }
      setConnected(false);
    };
  }, [pubsubToken, accountId, userId, wsUrl, clearTimers, resetPingTimer]);

  return { connected };
}
