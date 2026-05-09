import { useCallback, useEffect, useRef, useState } from "react";

const API_BASE = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_API_BASE ?? "/v1/social";

const RECHECK_INTERVAL_MS = 30_000; // 30 seconds

export type FallbackState = {
  /** `true` = backend unreachable, `false` = backend healthy, `null` = probe in flight */
  isFallback: boolean | null;
  /** Increments each time the backend transitions from down -> up (triggers remount) */
  recoveryCount: number;
  /** `true` while a periodic re-check fetch is in flight */
  isRechecking: boolean;
};

/**
 * Probes the API on mount, then re-checks every 30 seconds.
 *
 * - Returns `isFallback: null` while the initial probe is in flight.
 * - If the backend was down and comes back, `isFallback` flips to `false`
 *   and `recoveryCount` increments so consumers can remount data-fetching
 *   components.
 * - If the backend was up and goes down, `isFallback` flips to `true`.
 * - `isRechecking` is `true` while a periodic probe (not the initial one)
 *   is in flight, allowing the UI to show a "Reconnecting..." state.
 */
export function useFallbackDetector(): FallbackState {
  const [isFallback, setIsFallback] = useState<boolean | null>(null);
  const [recoveryCount, setRecoveryCount] = useState(0);
  const [isRechecking, setIsRechecking] = useState(false);

  // Track the last known fallback value across intervals without
  // triggering re-renders (avoids stale closures in the interval callback).
  const lastFallbackRef = useRef<boolean | null>(null);
  const isInitialProbeRef = useRef(true);

  const probe = useCallback(() => {
    const isInitial = isInitialProbeRef.current;
    if (!isInitial) setIsRechecking(true);

    fetch(`${API_BASE}/feed/home?limit=1`)
      .then((res) => {
        const down = !res.ok;
        const wasDown = lastFallbackRef.current === true;

        lastFallbackRef.current = down;
        setIsFallback(down);

        // Backend recovered — increment recovery counter
        if (wasDown && !down) {
          setRecoveryCount((c) => c + 1);
        }
      })
      .catch(() => {
        lastFallbackRef.current = true;
        setIsFallback(true);
      })
      .finally(() => {
        isInitialProbeRef.current = false;
        setIsRechecking(false);
      });
  }, []);

  useEffect(() => {
    // Initial probe
    probe();

    // Periodic re-check
    const id = setInterval(probe, RECHECK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [probe]);

  return { isFallback, recoveryCount, isRechecking };
}
