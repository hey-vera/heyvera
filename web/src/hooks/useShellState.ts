import { useMemo } from "react";

export type ShellState =
  | "public"
  | "signed_out"
  | "loading"
  | "profile_missing"
  | "ready";

type UseShellStateArgs = {
  authEnabled: boolean;
  isSignedIn: boolean;
  myProfileLoading: boolean;
  myProfileNotFound: boolean;
  hasProfile: boolean;
};

export function useShellState({
  authEnabled,
  isSignedIn,
  myProfileLoading,
  myProfileNotFound,
  hasProfile,
}: UseShellStateArgs) {
  return useMemo<ShellState>(() => {
    if (!authEnabled) return "public";
    if (!isSignedIn) return "signed_out";
    if (myProfileLoading) return "loading";
    if (myProfileNotFound || !hasProfile) return "profile_missing";
    return "ready";
  }, [authEnabled, isSignedIn, myProfileLoading, myProfileNotFound, hasProfile]);
}
