import { useEffect, useRef, useState } from 'react';
import { streamEvents } from '../../lib/api';

export type LiveConnection = 'connecting' | 'live' | 'offline';

/**
 * Subscribes to the live-map event stream while `enabled`. Calls `onPunch(userId)` the moment an
 * employee in scope clocks in / out. Reconnects automatically with backoff (and after the server
 * rotates the stream every ~14 minutes to re-check access).
 */
export function useLiveEvents(enabled: boolean, onPunch: (userId: string) => void): LiveConnection {
  const [status, setStatus] = useState<LiveConnection>('connecting');
  const handler = useRef(onPunch);
  handler.current = onPunch;

  useEffect(() => {
    if (!enabled) return;
    const ctrl = new AbortController();
    let attempt = 0;
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    (async () => {
      while (!ctrl.signal.aborted) {
        setStatus((s) => (s === 'live' ? s : 'connecting'));
        try {
          await streamEvents(
            '/admin/live-map/stream',
            (event, data) => {
              if (event === 'ready') {
                attempt = 0;
                setStatus('live');
              } else if (event === 'punch') {
                try {
                  handler.current((JSON.parse(data) as { userId: string }).userId);
                } catch {
                  /* ignore malformed event */
                }
              }
            },
            ctrl.signal,
          );
          // Server closed the stream normally (rotation): reconnect right away.
          if (ctrl.signal.aborted) return;
          await sleep(500);
        } catch {
          if (ctrl.signal.aborted) return;
          setStatus('offline');
          attempt++;
          await sleep(Math.min(30_000, 1000 * 2 ** attempt));
        }
      }
    })();

    return () => ctrl.abort();
  }, [enabled]);

  return enabled ? status : 'offline';
}
