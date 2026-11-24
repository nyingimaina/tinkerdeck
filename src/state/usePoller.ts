import { useEffect, useRef } from "react";
import Poller from "jattac-web-poller";

export interface PollOptions<T> {
  /** The thing to look at. Runs only while `enabled`. */
  func: () => Promise<T>;
  /** Called on every poll with whether the result changed (use `changed` to avoid pointless renders). */
  onResult: (value: T, changed: boolean) => void;
  onError?: (error: unknown, consecutive: number) => void;
  enabled?: boolean;
  /** Base interval; grows by the library's linear backoff while nothing changes. */
  intervalMs?: number;
  maxIntervalMs?: number;
  /** Stop after this many consecutive errors. */
  maxErrors?: number;
  /** Change this value to poll immediately (the manual refresh button). */
  refreshKey?: number | string;
}

/**
 * Low-cost live state (BRS 7.9). One poller per hook, which only exists while `enabled`; it stops
 * when the window is hidden or minimised and polls again at once when it is shown or focused.
 */
export function usePoller<T>({
  func,
  onResult,
  onError,
  enabled = true,
  intervalMs = 5000,
  maxIntervalMs = 30000,
  maxErrors = 5,
  refreshKey,
}: PollOptions<T>) {
  // always call the latest callbacks without recreating the poller
  const fn = useRef(func);
  const res = useRef(onResult);
  const err = useRef(onError);
  fn.current = func;
  res.current = onResult;
  err.current = onError;
  const poller = useRef<Poller<T> | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const p = new Poller<T>({
      func: () => fn.current(),
      onResult: (v, changed) => res.current(v, changed),
      onError: (e, n) => err.current?.(e, n),
      pollIntervalMilliseconds: intervalMs,
      maxIntervalMilliseconds: maxIntervalMs,
      maxConsecutiveErrors: maxErrors,
    });
    poller.current = p;
    const visible = () => typeof document === "undefined" || document.visibilityState !== "hidden";
    if (visible()) p.start();

    const onVisibility = () => {
      if (visible()) {
        p.resetBackoff();
        p.resume();
        p.pollNow();
      } else {
        void p.stop();
      }
    };
    const onFocus = () => {
      if (visible()) {
        p.resetBackoff();
        p.pollNow();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
      poller.current = null;
      void p.stop();
    };
  }, [enabled, intervalMs, maxIntervalMs, maxErrors]);

  // manual refresh
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    poller.current?.resetBackoff();
    poller.current?.pollNow();
  }, [refreshKey]);
}
