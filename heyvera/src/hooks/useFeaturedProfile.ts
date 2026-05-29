import { useEffect, useState } from "react";
import { fetchFeaturedProfile, fetchProfileWithLinkedAgents } from "../api/social";
import type { LinkedAgent, Profile } from "../api/social";

export type FeaturedProfileData = {
  profile: Profile;
  linkedAgents: LinkedAgent[];
};

export type DataStatus = "loading" | "live" | "fallback";

/**
 * Fetches the featured profile.
 * - If `handle` is provided, fetches that specific profile's linked-agents data.
 * - If `handle` is omitted, calls the /profiles/featured endpoint which returns
 *   the most recently created (first) profile on the network.
 */
export function useFeaturedProfile(handle?: string): {
  data: FeaturedProfileData | null;
  status: DataStatus;
  loading: boolean;
  error: Error | null;
} {
  const [data, setData] = useState<FeaturedProfileData | null>(null);
  const [status, setStatus] = useState<DataStatus>("loading");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setStatus("loading");
    setError(null);

    const fetcher = handle
      ? fetchProfileWithLinkedAgents(handle)
      : fetchFeaturedProfile();

    fetcher
      .then((result) => {
        if (!cancelled) {
          setData(result);
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
  }, [handle]);

  return { data, status, loading, error };
}
