import {
  SignInButton,
  SignOutButton,
  UserButton,
} from "@clerk/clerk-react";
import { useAuth } from "../../hooks/useAuth";

/**
 * Compact auth bar — shows sign in/out controls.
 * Renders nothing when ClerkProvider is not available.
 */
export function AuthBar() {
  const { isSignedIn, user } = useAuth();

  // If Clerk isn't loaded (no publishable key), don't render
  if (!user && !isSignedIn) {
    // Could be loading, or Clerk is not configured. Show sign-in for the
    // case where Clerk IS loaded but user is not signed in.
    try {
      return (
        <div className="auth-bar">
          <SignInButton mode="modal">
            <button type="button" className="button button-outline auth-bar-sign-in">
              Sign in
            </button>
          </SignInButton>
        </div>
      );
    } catch {
      // ClerkProvider not in tree
      return null;
    }
  }

  return (
    <div className="auth-bar auth-bar-signed-in">
      <div className="auth-bar-user">
        <UserButton afterSignOutUrl="/" />
        <span className="auth-bar-user-name">
          {user?.fullName ?? user?.primaryEmailAddress?.emailAddress ?? "You"}
        </span>
      </div>
      <SignOutButton>
        <button type="button" className="auth-bar-sign-out">
          Sign out
        </button>
      </SignOutButton>
    </div>
  );
}
