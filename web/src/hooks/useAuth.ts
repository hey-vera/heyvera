import { useAuth as useClerkAuth, useUser } from "@clerk/clerk-react";

export function useAuth() {
  try {
    const { isSignedIn, getToken } = useClerkAuth();
    const { user } = useUser();
    const viewerLabel =
      user?.fullName ??
      user?.username ??
      user?.primaryEmailAddress?.emailAddress ??
      null;
    return {
      authEnabled: true,
      isSignedIn: isSignedIn ?? false,
      getToken,
      viewerLabel,
    };
  } catch {
    // ClerkProvider not available (no publishable key)
    return {
      authEnabled: false,
      isSignedIn: false,
      getToken: async () => null as string | null,
      viewerLabel: null,
    };
  }
}
