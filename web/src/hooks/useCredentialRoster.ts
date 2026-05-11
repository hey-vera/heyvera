import { useEffect, useState } from "react";
import { fetchCredentialRoster, type RosterEntry } from "../api/identity";

export type CredentialRosterState =
  | { status: "loading" }
  | { status: "ok"; roster: RosterEntry[] }
  | { status: "error"; message: string };

export function useCredentialRoster(): CredentialRosterState {
  const [state, setState] = useState<CredentialRosterState>({
    status: "loading",
  });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    fetchCredentialRoster()
      .then((data) => {
        if (!cancelled) setState({ status: "ok", roster: data.roster });
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
