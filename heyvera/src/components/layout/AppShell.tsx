import React from "react";
import { ImagePlus, X } from "lucide-react";
import { SignInButton } from "@clerk/clerk-react";
import { useNavigate } from "react-router-dom";
import { createPost, fetchMyProfile, uploadMediaFile } from "../../api/social";
import { useAuth } from "../../hooks/useAuth";
import { ALLOWED_IMAGE_ACCEPT, validateImageFile } from "../../utils/imageUpload";
import { RightRail } from "./RightRail";
import { BottomBar } from "./BottomBar";
import { TopBar, type CreateAction } from "./TopBar";

const COMPOSE_MAX_CHARS = 280;

/** Dispatched after a successful shell compose so Home can prepend without refresh. */
export const HEYVERA_POST_CREATED_EVENT = "heyvera:post-created";

interface AppShellProps {
  children: React.ReactNode;
  activeRoute: string;
}

export function AppShell({ children, activeRoute }: AppShellProps) {
  const navigate = useNavigate();
  const { authEnabled, isSignedIn, getToken } = useAuth();
  const isMessagesRoute = activeRoute === "/messages";
  const isWideRoute =
    isMessagesRoute || activeRoute === "/videos" || activeRoute === "/live" || activeRoute === "/longform";
  const [composeOpen, setComposeOpen] = React.useState(false);
  const [composeText, setComposeText] = React.useState("");
  const [composeToken, setComposeToken] = React.useState<string | null>(null);
  const [isPosting, setIsPosting] = React.useState(false);
  const [isCheckingComposeAccess, setIsCheckingComposeAccess] = React.useState(false);
  const [composeGate, setComposeGate] = React.useState<"signed_out" | "profile_required" | null>(null);
  const [composeError, setComposeError] = React.useState<string | null>(null);
  const [imageFile, setImageFile] = React.useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = React.useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  const remainingChars = COMPOSE_MAX_CHARS - composeText.length;
  const canPost = (composeText.trim().length > 0 || Boolean(imageFile)) && !isPosting;

  const handleNavigate = (route: string) => {
    navigate(route);
  };

  const clearImage = () => {
    if (imagePreviewUrl) {
      URL.revokeObjectURL(imagePreviewUrl);
    }
    setImageFile(null);
    setImagePreviewUrl(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const resetCompose = () => {
    setComposeText("");
    setComposeToken(null);
    setComposeGate(null);
    setComposeError(null);
    setIsPosting(false);
    setIsCheckingComposeAccess(false);
    clearImage();
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
      if (
        msg.includes("404") ||
        msg.toLowerCase().includes("not found") ||
        msg.toLowerCase().includes("no profile")
      ) {
        setComposeGate("profile_required");
      } else {
        setComposeError("We could not verify your profile. Try again.");
      }
      setComposeOpen(true);
    } finally {
      setIsCheckingComposeAccess(false);
    }
  };

  const onPickImage = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    if (!file) return;

    const validationError = validateImageFile(file);
    if (validationError) {
      setComposeError(validationError);
      clearImage();
      return;
    }

    if (imagePreviewUrl) {
      URL.revokeObjectURL(imagePreviewUrl);
    }
    setImageFile(file);
    setImagePreviewUrl(URL.createObjectURL(file));
    setComposeError(null);
  };

  const handleCreateAction = (action: CreateAction) => {
    if (action === "post") {
      void openCompose();
      return;
    }
    if (action === "video") {
      navigate("/videos");
      return;
    }
    // Automate → Pulse surface (drafts); full Agents product remains WIP in the switcher.
    navigate("/ai");
  };

  const handleSubmitPost = async () => {
    if (!canPost || composeGate) return;

    setIsPosting(true);
    setComposeError(null);

    try {
      const token = composeToken!;
      const mediaIds: string[] = [];

      if (imageFile) {
        const uploaded = await uploadMediaFile(token, imageFile);
        mediaIds.push(uploaded.mediaId);
      }

      const result = await createPost(token, {
        body: composeText.trim(),
        ...(mediaIds.length > 0 ? { mediaIds } : {}),
      });

      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent(HEYVERA_POST_CREATED_EVENT, {
            detail: { post: result.post },
          }),
        );
      }
      closeCompose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Post failed. Try again.";
      setComposeError(msg);
      setIsPosting(false);
    }
  };

  return (
    <div className="min-h-screen" style={{ backgroundColor: "var(--bg-primary)" }}>
      <TopBar
        activeRoute={activeRoute}
        onNavigate={handleNavigate}
        onCreateAction={handleCreateAction}
        onProfileClick={() => handleNavigate("/profile")}
      />

      <div
        className={
          isWideRoute
            ? "mx-auto grid w-full max-w-[1225px] grid-cols-[1fr]"
            : "mx-auto grid w-full max-w-[1000px] grid-cols-[1fr] lg:grid-cols-[minmax(0,640px)_320px]"
        }
      >
        <main
          className="w-full min-w-0"
          style={{
            borderLeft: isWideRoute ? "none" : "1px solid var(--border-primary)",
            borderRight: isWideRoute ? "none" : "1px solid var(--border-primary)",
            minHeight: "100vh",
          }}
        >
          {children}
        </main>

        {!isWideRoute && (
          <div className="hidden min-w-0 lg:block lg:w-[320px]">
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
          role="presentation"
        >
          <div
            className="w-full max-w-[600px] overflow-hidden rounded-2xl"
            style={{ backgroundColor: "var(--bg-primary)", border: "1px solid var(--border-primary)" }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Create post"
          >
            <div
              className="flex items-center justify-between px-4 py-3"
              style={{ borderBottom: "1px solid var(--border-primary)" }}
            >
              <button
                onClick={closeCompose}
                className="rounded-full p-2 transition-colors hover-overlay"
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
                onClick={() => void handleSubmitPost()}
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
                  placeholder={
                    isCheckingComposeAccess ? "Checking profile..." : "Share something with the network"
                  }
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

                {imagePreviewUrl && (
                  <div
                    className="relative mt-3 overflow-hidden rounded-2xl border"
                    style={{ borderColor: "var(--border-primary)" }}
                  >
                    <img
                      src={imagePreviewUrl}
                      alt="Selected attachment"
                      className="max-h-[280px] w-full object-cover"
                    />
                    <button
                      type="button"
                      onClick={clearImage}
                      disabled={isPosting}
                      className="absolute right-2 top-2 rounded-full p-1.5"
                      style={{
                        backgroundColor: "color-mix(in srgb, var(--bg-primary) 80%, transparent)",
                        color: "var(--text-primary)",
                      }}
                      aria-label="Remove image"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                )}

                {composeError && (
                  <p className="mt-2 text-sm" style={{ color: "var(--color-danger)" }}>
                    {composeError}
                  </p>
                )}

                <div
                  className="mt-3 flex items-center justify-between pt-3"
                  style={{ borderTop: "1px solid var(--border-primary)" }}
                >
                  <div className="flex items-center gap-2">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept={ALLOWED_IMAGE_ACCEPT}
                      className="hidden"
                      onChange={onPickImage}
                      disabled={isPosting || isCheckingComposeAccess}
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isPosting || isCheckingComposeAccess}
                      className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors hover-overlay disabled:opacity-50"
                      style={{ color: "var(--accent)" }}
                      aria-label="Add image"
                    >
                      <ImagePlus className="h-4 w-4" aria-hidden="true" />
                      Image
                    </button>
                  </div>
                  <span
                    className="text-sm tabular-nums"
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
