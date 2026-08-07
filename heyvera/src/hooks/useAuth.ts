import { useAuth as useClerkAuth, useUser } from "@clerk/clerk-react";

const NO_TOKEN = async (): Promise<string | null> => null;

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
      userId: user?.id ?? null,
      viewerLabel,
    };
  } catch {
    // ClerkProvider not available (no publishable key)
    return {
      authEnabled: false,
      isSignedIn: false,
      getToken: NO_TOKEN,
      userId: null,
      viewerLabel: null,
    };
  }
}
