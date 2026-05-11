import type { AppRegion } from "./BottomRegionNav";
import type { ShellState } from "../../hooks/useShellState";

const regionMeta: Record<
  AppRegion,
  {
    title: string;
    question: string;
    action: string;
  }
> = {
  social: {
    title: "Vera Socials",
    question: "What's happening in your sovereign social network?",
    action: "Post",
  },
  agent: {
    title: "Agent",
    question: "What is my agent doing and what can it do next?",
    action: "Ask Vera",
  },
  market: {
    title: "Market",
    question: "What can I fund, buy, sell, or back here?",
    action: "Browse",
  },
  proof: {
    title: "Proof",
    question: "Why is this trusted and how did it become what it is?",
    action: "Inspect",
  },
};

type TopContextBarProps = {
  activeRegion: AppRegion;
  shellState: ShellState;
  viewerLabel: string | null;
  onPrimaryAction: () => void;
};

function shellStateSummary(shellState: ShellState, viewerLabel: string | null) {
  if (shellState === "public") {
    return "Read-only public preview";
  }
  if (shellState === "signed_out") {
    return "Sign in to begin genesis and unlock your shell";
  }
  if (shellState === "loading") {
    return "Loading identity and profile state";
  }
  if (shellState === "profile_missing") {
    return "Signed in. Profile setup still needed";
  }
  return viewerLabel ? `Signed in as ${viewerLabel}` : "Signed-in shell active";
}

export function TopContextBar({
  activeRegion,
  shellState,
  viewerLabel,
  onPrimaryAction,
}: TopContextBarProps) {
  const meta = regionMeta[activeRegion];
  const isSocial = activeRegion === "social";

  if (isSocial) {
    return (
      <div className="top-context-bar-social-strip" aria-label="Vera Socials status">
        <span className="top-context-status-dot" aria-hidden="true" />
        <span className="top-context-strip-status">
          {shellStateSummary(shellState, viewerLabel)}
        </span>
      </div>
    );
  }

  return (
    <header className="top-context-bar">
      <div className="top-context-copy">
        <p className="top-context-label">{meta.title}</p>
        <h2 className="top-context-title">{meta.question}</h2>
      </div>

      <div className="top-context-right">
        <div className="top-context-status">
          <span className="top-context-status-dot" aria-hidden="true" />
          <span>{shellStateSummary(shellState, viewerLabel)}</span>
        </div>
        <button
          type="button"
          className="button button-outline top-context-action"
          onClick={onPrimaryAction}
        >
          {meta.action}
        </button>
      </div>
    </header>
  );
}
