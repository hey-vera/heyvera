import { useAuth as useClerkAuth, useUser } from "@clerk/clerk-react";

export function useAuth() {
  try {
    const { isSignedIn, getToken } = useClerkAuth();
    const { user } = useUser();
    return {
      isSignedIn: isSignedIn ?? false,
      getToken,
      user,
    };
  } catch {
    // ClerkProvider not available (no publishable key)
    return {
      isSignedIn: false,
      getToken: async () => null as string | null,
      user: null,
    };
  }
}
