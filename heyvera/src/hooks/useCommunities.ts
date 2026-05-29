import { useEffect, useState } from "react";
import { fetchCommunities } from "../api/social";
import type { Community } from "../api/social";

export type DataStatus = "loading" | "live" | "fallback";

export function useCommunities(limit = 20): {
  data: Community[] | null;
  status: DataStatus;
  loading: boolean;
  error: Error | null;
} {
  const [data, setData] = useState<Community[] | null>(null);
  const [status, setStatus] = useState<DataStatus>("loading");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setStatus("loading");
    setError(null);

    fetchCommunities(limit)
      .then((result) => {
        if (!cancelled) {
          setData(result.communities);
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
