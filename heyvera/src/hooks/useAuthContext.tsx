import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useAuth } from "./useAuth";
import { useMyProfile } from "./useMyProfile";
import type { MyProfileData } from "./useMyProfile";
import type { LinkedAgent } from "../api/social";

type AuthContextValue = {
  authEnabled: boolean;
  isSignedIn: boolean;
  viewerLabel: string | null;
  getToken: () => Promise<string | null>;
  myProfile: MyProfileData | null;
  myProfileLoading: boolean;
  myProfileNotFound: boolean;
  refetchMyProfile: () => void;
  linkedAgents: LinkedAgent[];
  refreshCounter: number;
  triggerRefresh: () => void;
};

const AuthContext = createContext<AuthContextValue>({
  authEnabled: false,
  isSignedIn: false,
  viewerLabel: null,
  getToken: async () => null,
  myProfile: null,
  myProfileLoading: false,
  myProfileNotFound: false,
  refetchMyProfile: () => {},
  linkedAgents: [],
  refreshCounter: 0,
  triggerRefresh: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const { authEnabled, isSignedIn, getToken, viewerLabel } = useAuth();
  const [refreshCounter, setRefreshCounter] = useState(0);
  const triggerRefresh = useCallback(() => setRefreshCounter((c) => c + 1), []);

  // Memoize getToken so useMyProfile doesn't re-run on every render
  const stableGetToken = useMemo(() => {
    if (!isSignedIn) return async () => null as string | null;
    return getToken;
  }, [isSignedIn, getToken]);

  const {
    data: myProfile,
    loading: myProfileLoading,
    notFound: myProfileNotFound,
    refetch: refetchMyProfile,
  } = useMyProfile(stableGetToken);

  const linkedAgents = myProfile?.linkedAgents ?? [];

  const value = useMemo<AuthContextValue>(
    () => ({
      authEnabled,
      isSignedIn,
      viewerLabel,
      getToken,
      myProfile,
      myProfileLoading,
      myProfileNotFound,
      refetchMyProfile,
      linkedAgents,
      refreshCounter,
      triggerRefresh,
    }),
    [
      authEnabled,
      isSignedIn,
      viewerLabel,
      getToken,
      myProfile,
      myProfileLoading,
      myProfileNotFound,
      refetchMyProfile,
      linkedAgents,
      refreshCounter,
      triggerRefresh,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuthContext() {
  return useContext(AuthContext);
}
