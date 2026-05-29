import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { AuthBar } from "./AuthBar";

/**
 * Wraps AuthBar in an error boundary so it silently renders nothing
 * when ClerkProvider is missing (no VITE_CLERK_PUBLISHABLE_KEY).
 */

type Props = Record<string, never>;
type State = { hasError: boolean };

class AuthBarBoundary extends Component<{ children: ReactNode }, State> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Silently swallow Clerk-related context errors
    console.debug("AuthBar unavailable (Clerk not configured):", error.message, info);
  }

  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}

export function AuthBarSafe(_props: Props) {
  return (
    <AuthBarBoundary>
      <AuthBar />
    </AuthBarBoundary>
  );
}
