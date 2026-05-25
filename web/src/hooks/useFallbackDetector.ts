import { useCallback, useEffect, useRef, useState } from "react";

const RECHECK_INTERVAL_MS = 30_000; // 30 seconds
const PROBE_PATH = "/feed?limit=1";

type FallbackEnv = {
  [key: string]: string | boolean | undefined;
};

export type FallbackState = {
  /** `true` = backend unreachable, `false` = backend healthy, `null` = probe in flight */
  isFallback: boolean | null;
  /** Increments each time the backend transitions from down -> up (triggers remount) */
  recoveryCount: number;
  /** `true` while a periodic re-check fetch is in flight */
  isRechecking: boolean;
};

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, "");
}

export function getFallbackProbeUrl(env: FallbackEnv): string | null {
  const rawApiBase = env["VITE_API_URL"];
  const apiBase = typeof rawApiBase === "string" ? rawApiBase.trim() : "";
  if (!apiBase) return null;
  return `${trimTrailingSlashes(apiBase)}${PROBE_PATH}`;
}

export function isJsonContentType(contentType: string | null): boolean {
  if (!contentType) return false;
  return contentType.toLowerCase().includes("application/json");
}

export async function isHealthyFallbackResponse(
  response: Pick<Response, "ok" | "headers" | "json">,
): Promise<boolean> {
  if (!response.ok) return false;
  if (!isJsonContentType(response.headers.get("content-type"))) return false;

  try {
    await response.json();
    return true;
  } catch {
    return false;
  }
}

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
  const probeUrl = getFallbackProbeUrl(import.meta.env);

  // Track the last known fallback value across intervals without
  // triggering re-renders (avoids stale closures in the interval callback).
  const lastFallbackRef = useRef<boolean | null>(null);
  const isInitialProbeRef = useRef(true);

  const probe = useCallback(() => {
    if (!probeUrl) {
      // No API URL configured — treat as fallback/unavailable so the UI
      // shows proper empty states instead of silently serving nothing.
      lastFallbackRef.current = true;
      isInitialProbeRef.current = false;
      setIsFallback(true);
      setIsRechecking(false);
      return;
    }

    const isInitial = isInitialProbeRef.current;
    if (!isInitial) setIsRechecking(true);

    fetch(probeUrl)
      .then(async (res) => {
        const down = !(await isHealthyFallbackResponse(res));
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
  }, [probeUrl]);

  useEffect(() => {
    // Initial probe
    probe();

    // Periodic re-check
    if (!probeUrl) return;
    const id = setInterval(probe, RECHECK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [probe, probeUrl]);

  return { isFallback, recoveryCount, isRechecking };
}
