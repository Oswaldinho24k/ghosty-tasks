import { useEffect, useRef } from "react";
import type { WwEvent } from "../server/bus.server";

// Una conexión SSE por pestaña. EventSource reconecta solo; en cada (re)apertura
// dispara onReconnect → revalida la vista activa para no perder eventos.
export function useLiveStream(handlers: {
  onEvent: (ev: WwEvent) => void;
  onReconnect: () => void;
}) {
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    const es = new EventSource("/api/stream");
    es.addEventListener("open", () => ref.current.onReconnect());
    es.onmessage = (e) => {
      try {
        ref.current.onEvent(JSON.parse(e.data) as WwEvent);
      } catch {
        /* heartbeat u otra línea no-JSON */
      }
    };
    const onVis = () => {
      if (document.visibilityState === "visible") ref.current.onReconnect();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      es.close();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);
}
