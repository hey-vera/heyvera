import { useEffect, useState } from "react";
import { fetchLongform } from "../api/social";
import type { LongformEntry } from "../api/social";

export type DataStatus = "loading" | "live" | "fallback";

export function useLongform(limit = 20): {
  data: LongformEntry[] | null;
  status: DataStatus;
  loading: boolean;
  error: Error | null;
} {
  const [data, setData] = useState<LongformEntry[] | null>(null);
  const [status, setStatus] = useState<DataStatus>("loading");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setStatus("loading");
    setError(null);

    fetchLongform(limit)
      .then((result) => {
        if (!cancelled) {
          setData(result.longform);
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
  }, [limit]);

  return { data, status, loading, error };
}
