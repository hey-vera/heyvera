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
  const { authEnabled, isSignedIn, viewerLabel } = useAuth();

  if (!authEnabled) {
    return null;
  }

  if (!isSignedIn) {
    return (
      <div className="auth-bar">
        <SignInButton mode="modal">
          <button type="button" className="button button-outline auth-bar-sign-in">
            Sign in
          </button>
        </SignInButton>
      </div>
    );
  }

  return (
    <div className="auth-bar auth-bar-signed-in">
      <div className="auth-bar-user">
        <UserButton afterSignOutUrl="/" />
        <span className="auth-bar-user-name">{viewerLabel ?? "You"}</span>
      </div>
      <SignOutButton>
        <button type="button" className="auth-bar-sign-out">
          Sign out
        </button>
      </SignOutButton>
    </div>
  );
}
