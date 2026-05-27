import React from "react";
import { BarChart3, Gift, Image, Smile, X } from "lucide-react";
import { SignInButton } from "@clerk/clerk-react";
import { useNavigate } from "react-router-dom";
import { createPost, fetchMyProfile } from "../../api/social";
import { useAuth } from "../../hooks/useAuth";
import { LeftNav } from "./LeftNav";
import { RightRail } from "./RightRail";
import { BottomBar } from "./BottomBar";
import { TopBar } from "./TopBar";

const COMPOSE_MAX_CHARS = 280;

interface AppShellProps {
  children: React.ReactNode;
  activeRoute: string;
}

export function AppShell({ children, activeRoute }: AppShellProps) {
  const navigate = useNavigate();
  const { authEnabled, isSignedIn, getToken } = useAuth();
  const isMessagesRoute = activeRoute === "/messages";
  const [composeOpen, setComposeOpen] = React.useState(false);
  const [composeText, setComposeText] = React.useState("");
  const [composeToken, setComposeToken] = React.useState<string | null>(null);
  const [isPosting, setIsPosting] = React.useState(false);
  const [isCheckingComposeAccess, setIsCheckingComposeAccess] = React.useState(false);
  const [composeGate, setComposeGate] = React.useState<"signed_out" | "profile_required" | null>(null);
  const [composeError, setComposeError] = React.useState<string | null>(null);

  const remainingChars = COMPOSE_MAX_CHARS - composeText.length;
  const canPost = composeText.trim().length > 0 && !isPosting;

  const handleNavigate = (route: string) => {
    navigate(route);
  };

  const resetCompose = () => {
    setComposeText("");
    setComposeToken(null);
    setComposeGate(null);
    setComposeError(null);
    setIsPosting(false);
    setIsCheckingComposeAccess(false);
  };

  const closeCompose = () => {
    setComposeOpen(false);
    resetCompose();
  };

  const openCompose = async () => {
    setComposeError(null);

    if (!authEnabled || !isSignedIn) {
      setComposeGate("signed_out");
      setComposeOpen(true);
      return;
    }

    setIsCheckingComposeAccess(true);
    try {
      const token = await getToken();
      if (!token) {
        setComposeGate("signed_out");
        setComposeOpen(true);
        return;
      }

      await fetchMyProfile(token);
      setComposeGate(null);
      setComposeToken(token);
      setComposeOpen(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("404") || msg.toLowerCase().includes("not found")) {
        setComposeGate("profile_required");
      } else {
        setComposeError("We could not verify your profile. Try again.");
      }
      setComposeOpen(true);
    } finally {
      setIsCheckingComposeAccess(false);
    }
  };

  const handleSubmitPost = async () => {
    if (!canPost || composeGate) return;

    setIsPosting(true);
    setComposeError(null);

    try {
      await createPost(composeToken!, { body: composeText.trim() });
      closeCompose();
    } catch {
      setComposeError("Post failed. Try again.");
      setIsPosting(false);
    }
  };

  return (
    <div className="min-h-screen" style={{ backgroundColor: "var(--bg-primary)" }}>
      <LeftNav
        activeRoute={activeRoute}
        onNavigate={handleNavigate}
        onCompose={() => void openCompose()}
      />

      <TopBar title="HeyVera" onProfileClick={() => handleNavigate("/profile")} />

      <div
        className={
          isMessagesRoute
            ? "mx-auto grid w-full grid-cols-[1fr] sm:grid-cols-[88px_minmax(0,1fr)] md:grid-cols-[88px_minmax(0,1fr)] lg:max-w-[978px] lg:grid-cols-[88px_minmax(0,890px)] xl:max-w-[1225px] xl:grid-cols-[275px_minmax(0,950px)]"
            : "mx-auto grid w-full grid-cols-[1fr] sm:grid-cols-[88px_minmax(0,1fr)] md:grid-cols-[88px_minmax(0,1fr)] lg:max-w-[978px] lg:grid-cols-[88px_600px_290px] xl:max-w-[1225px] xl:grid-cols-[275px_600px_350px]"
        }
      >
        <div className="hidden sm:block" aria-hidden="true" />
        <main
          className="w-full min-w-0"
          style={{
            borderLeft: "1px solid var(--border-primary)",
            borderRight: "1px solid var(--border-primary)",
            minHeight: "100vh",
          }}
        >
          {children}
        </main>

        {!isMessagesRoute && (
          <div className="hidden min-w-0 lg:block lg:w-[290px] xl:w-[350px]">
            <RightRail />
          </div>
        )}
      </div>

      <BottomBar
        activeRoute={activeRoute}
        onNavigate={handleNavigate}
        onCompose={() => void openCompose()}
      />

      {composeOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-12 sm:pt-16"
          style={{ backgroundColor: "color-mix(in srgb, var(--bg-primary) 60%, transparent)" }}
          onClick={closeCompose}
        >
          <div
            className="w-full max-w-[600px] overflow-hidden rounded-2xl"
            style={{ backgroundColor: "var(--bg-primary)", border: "1px solid var(--border-primary)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="flex items-center justify-between px-4 py-3"
              style={{ borderBottom: "1px solid var(--border-primary)" }}
            >
              <button
                onClick={closeCompose}
                className="rounded-full p-2 transition-colors hover:bg-white/10"
                style={{ color: "var(--text-primary)" }}
                aria-label="Close compose"
                type="button"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
              <button
                className="rounded-full px-5 py-1.5 text-sm font-bold transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
                style={{ backgroundColor: "var(--accent)", color: "var(--bg-primary)" }}
                disabled={!canPost || Boolean(composeGate)}
                onClick={handleSubmitPost}
                type="button"
              >
                {isPosting ? "Posting" : "Post"}
              </button>
            </div>
            {composeGate ? (
              <ComposeGate
                gate={composeGate}
                authEnabled={authEnabled}
                onCreateProfile={() => {
                  closeCompose();
                  navigate("/profile");
                }}
              />
            ) : (
              <div className="px-4 pb-4 pt-3">
                <textarea
                  placeholder={isCheckingComposeAccess ? "Checking profile..." : "What's happening?"}
                  autoFocus
                  className="w-full resize-none border-none bg-transparent text-xl outline-none placeholder:text-[var(--text-secondary)]"
                  style={{ color: "var(--text-primary)", minHeight: "144px" }}
                  value={composeText}
                  onChange={(event) => {
                    setComposeText(event.target.value.slice(0, COMPOSE_MAX_CHARS));
                    setComposeError(null);
                  }}
                  maxLength={COMPOSE_MAX_CHARS}
                  disabled={isPosting || isCheckingComposeAccess}
                />

                {composeError && (
                  <p className="mt-2 text-sm" style={{ color: "var(--color-danger)" }}>
                    {composeError}
                  </p>
                )}

                <div
                  className="mt-3 flex items-center justify-between pt-3"
                  style={{ borderTop: "1px solid var(--border-primary)" }}
                >
                  <div className="flex items-center gap-1">
                    {[
                      { label: "Add media", icon: Image },
                      { label: "Add GIF", icon: Gift },
                      { label: "Create poll", icon: BarChart3 },
                      { label: "Add emoji", icon: Smile },
                    ].map(({ label, icon: Icon }) => (
                      <button
                        key={label}
                        type="button"
                        className="rounded-full p-2 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                        style={{ color: "var(--accent)" }}
                        aria-label={label}
                        disabled={isPosting || isCheckingComposeAccess}
                      >
                        <Icon className="h-5 w-5" aria-hidden="true" />
                      </button>
                    ))}
                  </div>
                  <span
                    className="text-sm"
                    style={{ color: remainingChars <= 20 ? "var(--color-danger)" : "var(--text-secondary)" }}
                    aria-live="polite"
                  >
                    {remainingChars}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ComposeGate({
  gate,
  authEnabled,
  onCreateProfile,
}: {
  gate: "signed_out" | "profile_required";
  authEnabled: boolean;
  onCreateProfile: () => void;
}) {
  if (gate === "profile_required") {
    return (
      <div className="px-6 py-10">
        <h2 className="text-[23px] font-bold leading-tight" style={{ color: "var(--text-primary)" }}>
          Create your profile first
        </h2>
        <p className="mt-2 text-[15px] leading-relaxed" style={{ color: "var(--text-secondary)" }}>
          Your sign-in is ready. HeyVera still needs a profile so posts have a name, handle, and identity.
        </p>
        <button
          type="button"
          onClick={onCreateProfile}
          className="mt-5 rounded-full px-5 py-2 text-[15px] font-bold transition-opacity hover:opacity-90"
          style={{ backgroundColor: "var(--accent)", color: "#000" }}
        >
          Create profile
        </button>
      </div>
    );
  }

  return (
    <div className="px-6 py-10">
      <h2 className="text-[23px] font-bold leading-tight" style={{ color: "var(--text-primary)" }}>
        Sign in to post
      </h2>
      <p className="mt-2 text-[15px] leading-relaxed" style={{ color: "var(--text-secondary)" }}>
        Sign in with Clerk, then create your HeyVera profile.
      </p>
      {authEnabled ? (
        <SignInButton mode="modal">
          <button
            type="button"
            className="mt-5 rounded-full px-5 py-2 text-[15px] font-bold transition-opacity hover:opacity-90"
            style={{ backgroundColor: "var(--accent)", color: "#000" }}
          >
            Sign in
          </button>
        </SignInButton>
      ) : (
        <p className="mt-4 text-[13px]" style={{ color: "var(--text-secondary)" }}>
          Sign-in is not configured for this environment.
        </p>
      )}
    </div>
  );
}
