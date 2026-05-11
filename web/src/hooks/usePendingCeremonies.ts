import { useEffect, useState } from "react";
import { fetchPendingCeremonies, type CeremonyEntry } from "../api/identity";

export type PendingCeremoniesState =
  | { status: "loading" }
  | { status: "ok"; ceremonies: CeremonyEntry[] }
  | { status: "error"; message: string };

export function usePendingCeremonies(): PendingCeremoniesState {
  const [state, setState] = useState<PendingCeremoniesState>({
    status: "loading",
  });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    fetchPendingCeremonies()
      .then((data) => {
        if (!cancelled)
          setState({ status: "ok", ceremonies: data.ceremonies });
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setState({
            status: "error",
            message: err instanceof Error ? err.message : "Unknown error",
          });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
