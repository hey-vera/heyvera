import React from "react";
import { BarChart3, Gift, Image, Smile, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { createPost } from "../../api/client";
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
  const [composeOpen, setComposeOpen] = React.useState(false);
  const [composeText, setComposeText] = React.useState("");
  const [isPosting, setIsPosting] = React.useState(false);
  const [composeError, setComposeError] = React.useState<string | null>(null);

  const remainingChars = COMPOSE_MAX_CHARS - composeText.length;
  const canPost = composeText.trim().length > 0 && !isPosting;

  const handleNavigate = (route: string) => {
    navigate(route);
  };

  const resetCompose = () => {
    setComposeText("");
    setComposeError(null);
    setIsPosting(false);
  };

  const closeCompose = () => {
    setComposeOpen(false);
    resetCompose();
  };

  const handleSubmitPost = async () => {
    if (!canPost) return;

    setIsPosting(true);
    setComposeError(null);

    try {
      await createPost(composeText.trim());
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
        onCompose={() => setComposeOpen(true)}
      />

      <TopBar title="HeyVera" />

      <div className="flex justify-center" style={{ paddingLeft: "0px" }}>
        <div
          className="w-full lg:pl-[88px] xl:pl-[275px] flex justify-center xl:justify-start"
          style={{ maxWidth: "1265px" }}
        >
          <main
            className="w-full sm:max-w-[600px] lg:max-w-[600px] flex-1"
            style={{
              borderLeft: "1px solid var(--border-primary)",
              borderRight: "1px solid var(--border-primary)",
              minHeight: "100vh",
            }}
          >
            {children}
          </main>

          <div className="hidden lg:block lg:w-[290px] xl:w-[350px] flex-shrink-0">
            <RightRail />
          </div>
        </div>
      </div>

      <BottomBar
        activeRoute={activeRoute}
        onNavigate={handleNavigate}
        onCompose={() => setComposeOpen(true)}
      />

      {composeOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-12 sm:pt-16"
          style={{ backgroundColor: "rgba(0,0,0,0.6)" }}
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
                disabled={!canPost}
                onClick={handleSubmitPost}
                type="button"
              >
                {isPosting ? "Posting" : "Post"}
              </button>
            </div>
            <div className="px-4 pb-4 pt-3">
              <textarea
                placeholder="What's happening?"
                autoFocus
                className="w-full resize-none border-none bg-transparent text-xl outline-none placeholder:text-[var(--text-secondary)]"
                style={{ color: "var(--text-primary)", minHeight: "144px" }}
                value={composeText}
                onChange={(event) => {
                  setComposeText(event.target.value.slice(0, COMPOSE_MAX_CHARS));
                  setComposeError(null);
                }}
                maxLength={COMPOSE_MAX_CHARS}
                disabled={isPosting}
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
                      disabled={isPosting}
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
          </div>
        </div>
      )}
    </div>
  );
}
