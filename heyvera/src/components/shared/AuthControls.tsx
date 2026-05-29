import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { LogIn, User } from "lucide-react";
import { SignInButton, SignUpButton, UserButton } from "@clerk/clerk-react";
import { useAuth } from "../../hooks/useAuth";

type AuthControlVariant = "mobile" | "desktop";

interface AuthControlsProps {
  variant: AuthControlVariant;
  onProfile: () => void;
}

type BoundaryProps = AuthControlsProps & {
  children: ReactNode;
};

type BoundaryState = {
  hasError: boolean;
};

const clerkConfigured = Boolean(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);

class AuthControlsBoundary extends Component<BoundaryProps, BoundaryState> {
  constructor(props: BoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): BoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.debug("Layout auth controls unavailable:", error.message, info);
  }

  render() {
    if (this.state.hasError) {
      return <FallbackAuthControls variant={this.props.variant} onProfile={this.props.onProfile} />;
    }

    return this.props.children;
  }
}

function FallbackAuthControls({ variant, onProfile }: AuthControlsProps) {
  if (variant === "mobile") {
    return (
      <button
        onClick={onProfile}
        aria-label="Account"
        className="flex h-8 w-8 items-center justify-center rounded-full transition-colors hover-overlay focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
        style={{ color: "var(--text-primary)" }}
        type="button"
      >
        <User className="h-5 w-5" aria-hidden="true" />
      </button>
    );
  }

  return (
    <button
      className="flex w-full items-center gap-3 rounded-full px-3 py-3 transition-colors hover-overlay xl:w-auto"
      onClick={onProfile}
      aria-label="Account"
      type="button"
    >
      <span
        className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full"
        style={{ backgroundColor: "var(--bg-elevated)", color: "var(--text-primary)" }}
        aria-hidden="true"
      >
        <User className="h-5 w-5" />
      </span>
      <span className="hidden min-w-0 flex-1 flex-col items-start xl:flex">
        <span className="w-full truncate text-sm font-bold leading-tight" style={{ color: "var(--text-primary)" }}>
          Account
        </span>
        <span className="w-full truncate text-sm leading-tight" style={{ color: "var(--text-secondary)" }}>
          Profile
        </span>
      </span>
    </button>
  );
}

function SignedOutControls({ variant }: Pick<AuthControlsProps, "variant">) {
  if (variant === "mobile") {
    return (
      <SignInButton mode="modal">
        <button
          className="flex h-8 w-8 items-center justify-center rounded-full transition-colors hover-overlay focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          style={{ color: "var(--text-primary)" }}
          type="button"
          aria-label="Sign in"
        >
          <LogIn className="h-5 w-5" aria-hidden="true" />
        </button>
      </SignInButton>
    );
  }

  return (
    <div className="mb-4 flex w-full flex-col gap-2 px-1 xl:px-0">
      <SignInButton mode="modal">
        <button
          className="flex w-full items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm font-bold transition-colors hover-overlay"
          style={{ color: "var(--text-primary)", border: "1px solid var(--border-primary)" }}
          type="button"
        >
          <LogIn className="h-4 w-4" aria-hidden="true" />
          <span className="hidden xl:inline">Sign in</span>
        </button>
      </SignInButton>
      <SignUpButton mode="modal">
        <button
          className="hidden w-full rounded-full px-4 py-2.5 text-sm font-bold transition-colors xl:block"
          style={{ backgroundColor: "var(--text-primary)", color: "var(--bg-primary)" }}
          type="button"
        >
          Join
        </button>
      </SignUpButton>
    </div>
  );
}

function ClerkAuthControls({ variant, onProfile }: AuthControlsProps) {
  const { authEnabled, isSignedIn, viewerLabel } = useAuth();

  if (!authEnabled) {
    return <FallbackAuthControls variant={variant} onProfile={onProfile} />;
  }

  if (!isSignedIn) {
    return <SignedOutControls variant={variant} />;
  }

  if (variant === "mobile") {
    return (
      <div className="flex h-8 w-8 items-center justify-center">
        <UserButton afterSignOutUrl="/" userProfileMode="navigation" userProfileUrl="/profile" />
      </div>
    );
  }

  return (
    <div className="mb-4 flex w-full items-center gap-3 rounded-full px-3 py-3 transition-colors hover-overlay xl:w-auto">
      <UserButton afterSignOutUrl="/" userProfileMode="navigation" userProfileUrl="/profile" />
      <button
        className="hidden min-w-0 flex-1 flex-col items-start text-left xl:flex"
        onClick={onProfile}
        type="button"
      >
        <span className="w-full truncate text-sm font-bold leading-tight" style={{ color: "var(--text-primary)" }}>
          {viewerLabel ?? "Account"}
        </span>
        <span className="w-full truncate text-sm leading-tight" style={{ color: "var(--text-secondary)" }}>
          View profile
        </span>
      </button>
    </div>
  );
}

export function AuthControls(props: AuthControlsProps) {
  if (!clerkConfigured) {
    return <FallbackAuthControls {...props} />;
  }

  return (
    <AuthControlsBoundary {...props}>
      <ClerkAuthControls {...props} />
    </AuthControlsBoundary>
  );
}
