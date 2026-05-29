import { useEffect, useState } from "react";
import { fetchProfileStats } from "../api/social";
import type { ProfileStats } from "../api/social";

export type DataStatus = "loading" | "live" | "fallback";

/**
 * Fetches stats for a profile by handle.
 * Pass `undefined` or an empty string to skip fetching (returns null with
 * status "loading" until a real handle is supplied).
 *
 * Pass a `refreshCounter` to trigger re-fetching when data changes
 * (e.g., after creating a post).
 */
export function useProfileStats(handle: string | undefined, refreshCounter = 0): {
  data: ProfileStats | null;
  status: DataStatus;
  loading: boolean;
  error: Error | null;
} {
  const [data, setData] = useState<ProfileStats | null>(null);
  const [status, setStatus] = useState<DataStatus>("loading");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!handle) {
      // No handle yet — stay in loading state until one arrives
      setData(null);
      setStatus("loading");
      setLoading(true);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setStatus("loading");
    setError(null);

    fetchProfileStats(handle)
      .then((result) => {
        if (!cancelled) {
          setData(result.stats);
          setStatus("live");
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error(String(err)));
          setStatus("fallback");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [handle, refreshCounter]);

  return { data, status, loading, error };
}
