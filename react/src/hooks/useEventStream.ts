import { useEffect, useRef, useState } from 'react';
import type { LogEvent } from '../types';
import { EVENTS_URL, MAX_EVENTS } from '../config';

// Subscribes to the log-streamer's SSE feed and exposes a rolling buffer of
// the most recent events. One instance is mounted at the App level; pages
// read from it via context so navigation doesn't tear down the connection.
//
// Reconnect behavior: EventSource auto-reconnects on transient failures, but
// if the server explicitly closes (e.g., the streamer restarts), we close +
// reopen after a short delay. `connected` reflects the live state.
export function useEventStream() {
  const [events, setEvents] = useState<LogEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function open() {
      if (cancelled) return;
      const source = new EventSource(EVENTS_URL);
      sourceRef.current = source;

      source.onopen = () => {
        if (!cancelled) setConnected(true);
      };

      source.onmessage = (msg) => {
        if (cancelled || !msg.data) return;
        let parsed: LogEvent;
        try {
          parsed = JSON.parse(msg.data) as LogEvent;
        } catch {
          return;
        }
        setEvents((prev) => {
          const next = prev.length >= MAX_EVENTS
            ? prev.slice(prev.length - MAX_EVENTS + 1)
            : prev.slice();
          next.push(parsed);
          return next;
        });
      };

      source.onerror = () => {
        if (cancelled) return;
        setConnected(false);
        // EventSource will retry on its own for transient errors. We only
        // force a reconnect if the connection is fully closed.
        if (source.readyState === EventSource.CLOSED) {
          source.close();
          reconnectTimer = setTimeout(open, 1500);
        }
      };
    }

    open();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      sourceRef.current?.close();
      sourceRef.current = null;
    };
  }, []);

  function clear() {
    setEvents([]);
  }

  return { events, connected, clear };
}
