"use client";

import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";

export type TrackingEvent = {
  id: string;
  message_id: string;
  event_type: "open" | "click";
  redirect_url: string | null;
  user_agent: string | null;
  ip: string | null;
  created_at: string;
};

/**
 * Subscribe to tracking events for a single message_id.
 *
 * Connects to `wss://$NEXT_PUBLIC_AI_BRIDGE_URL/socket.io/` on mount, joins
 * the per-message room, and appends each incoming event to state. Cleans up
 * on unmount or when message_id changes.
 *
 * MVP note: the Socket.io server is unauthenticated. Anyone with the URL
 * can subscribe to any message_id. Tighten in a later auth pass.
 */
export function useTrackingEvents(messageId: string | null): {
  events: TrackingEvent[];
  connected: boolean;
} {
  const [events, setEvents] = useState<TrackingEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!messageId) {
      setEvents([]);
      setConnected(false);
      return;
    }

    const base = process.env.NEXT_PUBLIC_AI_BRIDGE_URL;
    if (!base) {
      // eslint-disable-next-line no-console
      console.warn("NEXT_PUBLIC_AI_BRIDGE_URL not set — tracking hook is inert");
      return;
    }

    const socket = io(base, {
      path: "/socket.io",
      transports: ["websocket", "polling"],
      reconnection: true,
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
      socket.emit("subscribe", { message_id: messageId });
    });

    socket.on("disconnect", () => {
      setConnected(false);
    });

    socket.on("tracking_event", (evt: TrackingEvent) => {
      if (evt.message_id === messageId) {
        setEvents((prev) => [...prev, evt]);
      }
    });

    return () => {
      socket.emit("unsubscribe", { message_id: messageId });
      socket.disconnect();
      socketRef.current = null;
      setEvents([]);
      setConnected(false);
    };
  }, [messageId]);

  return { events, connected };
}
