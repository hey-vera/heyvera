import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { AuthProvider } from "./useAuthContext";

/**
 * Wraps AuthProvider in an error boundary so the app degrades gracefully
 * when ClerkProvider is not in the tree (no VITE_CLERK_PUBLISHABLE_KEY).
 */

type State = { hasError: boolean };

class AuthProviderBoundary extends Component<
  { children: ReactNode },
  State
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.debug(
      "AuthProvider unavailable (Clerk not configured):",
      error.message,
      info,
    );
  }

  render() {
    if (this.state.hasError) {
      // Render children without auth context — they'll get the default
      // "not signed in" state from useAuthContext.
      return this.props.children;
    }
    return this.props.children;
  }
}

export function AuthProviderSafe({ children }: { children: ReactNode }) {
  return (
    <AuthProviderBoundary>
      <AuthProvider>{children}</AuthProvider>
    </AuthProviderBoundary>
  );
}
