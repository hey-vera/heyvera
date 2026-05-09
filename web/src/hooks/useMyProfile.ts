import { useCallback, useEffect, useState } from "react";
import { fetchMyProfile } from "../api/social";
import type { LinkedAgent, Profile } from "../api/social";

export type MyProfileData = {
  profile: Profile;
  linkedAgents: LinkedAgent[];
};

/**
 * Fetches the authenticated user's own profile via GET /profile/me.
 * Returns null when signed out or when the user has no profile (404).
 * Call `refetch()` after creating a profile to reload.
 */
export function useMyProfile(getToken: () => Promise<string | null>): {
  data: MyProfileData | null;
  loading: boolean;
  error: Error | null;
  notFound: boolean;
  refetch: () => void;
} {
  const [data, setData] = useState<MyProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [trigger, setTrigger] = useState(0);

  const refetch = useCallback(() => setTrigger((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setNotFound(false);

    getToken()
      .then((token) => {
        if (!token || cancelled) {
          if (!cancelled) {
            setLoading(false);
            setData(null);
          }
          return;
        }
        return fetchMyProfile(token).then((result) => {
          if (!cancelled) {
            setData(result);
          }
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message =
          err instanceof Error ? err.message : String(err);
        if (message.includes("404") || message.includes("not found") || message.includes("No profile found")) {
          setNotFound(true);
          setData(null);
        } else {
          setError(err instanceof Error ? err : new Error(message));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [getToken, trigger]);

  return { data, loading, error, notFound, refetch };
}
