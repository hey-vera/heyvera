import { useEffect, useState } from "react";
import { fetchHomeFeed } from "../api/social";
import type { FeedPost } from "../api/social";

export type DataStatus = "loading" | "live" | "fallback";

export function useHomeFeed(limit = 20, filter?: string): {
  data: FeedPost[] | null;
  status: DataStatus;
  loading: boolean;
  error: Error | null;
} {
  const [data, setData] = useState<FeedPost[] | null>(null);
  const [status, setStatus] = useState<DataStatus>("loading");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setStatus("loading");
    setError(null);

    fetchHomeFeed(limit, 0, filter)
      .then((result) => {
        if (!cancelled) {
          setData(result.feed);
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
  }, [limit, filter]);

  return { data, status, loading, error };
}
