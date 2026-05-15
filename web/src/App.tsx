import { Component, useState } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { ApiErrorBanner } from "./components/shared/ApiErrorBanner";
import { PageShell } from "./components/layout/PageShell";
import { AuthProviderSafe } from "./hooks/AuthProviderSafe";
import { useAuthContext } from "./hooks/useAuthContext";
import { useFallbackDetector } from "./hooks/useFallbackDetector";
import { useShellState } from "./hooks/useShellState";
import {
  BottomRegionNav,
  type AppRegion,
} from "./components/app/BottomRegionNav";
import { AgentRegion } from "./components/app/AgentRegion";
import { IdentityRegion } from "./components/app/IdentityRegion";
import { ProofRegion } from "./components/app/ProofRegion";
import { VeraSocials } from "./components/app/VeraSocials";
import { RegionPlaceholder } from "./components/app/RegionPlaceholder";
import { RegionRail } from "./components/app/RegionRail";
import { TopContextBar } from "./components/app/TopContextBar";

type ErrorBoundaryProps = { children: ReactNode };
type ErrorBoundaryState = { hasError: boolean };

class RegionErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("RegionErrorBoundary caught:", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="tab-error-state">
          <p className="tab-error-headline">
            Something went wrong loading this region.
          </p>
          <button
            type="button"
            className="button button-outline tab-error-retry"
            onClick={() => {
              this.setState({ hasError: false });
              window.location.reload();
            }}
          >
            Refresh page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function AppShell() {
  const [activeRegion, setActiveRegion] = useState<AppRegion>("social");
  const { isFallback, recoveryCount, isRechecking } = useFallbackDetector();
  const {
    authEnabled,
    isSignedIn,
    viewerLabel,
    myProfile,
    myProfileLoading,
    myProfileNotFound,
  } = useAuthContext();
  const shellState = useShellState({
    authEnabled,
    isSignedIn,
    myProfileLoading,
    myProfileNotFound,
    hasProfile: !!myProfile,
  });

  return (
    <PageShell>
      <RegionRail
        activeRegion={activeRegion}
        onChange={setActiveRegion}
        shellState={shellState}
        viewerLabel={myProfile?.profile.displayName ?? viewerLabel}
      />

      <main className="app-shell-main">
        {isFallback === true && (
          <ApiErrorBanner
            isFallback={isFallback}
            isRechecking={isRechecking}
          />
        )}

        <TopContextBar
          activeRegion={activeRegion}
          shellState={shellState}
          viewerLabel={myProfile?.profile.displayName ?? viewerLabel}
        />

        <RegionErrorBoundary key={`${activeRegion}-${recoveryCount}`}>
          {activeRegion === "social" && (
            <VeraSocials shellState={shellState} />
          )}
          {activeRegion === "agent" && (
            <AgentRegion shellState={shellState} />
          )}
          {activeRegion === "identity" && (
            <IdentityRegion shellState={shellState} />
          )}
          {activeRegion === "market" && (
            <RegionPlaceholder
              region="market"
              title="Market needs real launch, work, package, and bounty contracts."
              intro="The region shape is clear, but trust-pool participation and marketplace behavior are not live here yet. This stays an honest scaffold until Vera and Soma lock the primitives."
              sections={[
                {
                  label: "Ready now",
                  items: [
                    "Market shell and subnavigation",
                    "Launches, Work, Packages, and Bounties IA",
                    "Truthful non-live states",
                  ],
                },
                {
                  label: "Blocked on Vera and Soma",
                  items: [
                    "Trust-pool launch objects",
                    "Work and package listing contracts",
                    "Bounty primitives",
                    "Wallet, settlement, and participation signing semantics",
                  ],
                },
              ]}
            />
          )}
          {activeRegion === "proof" && (
            <ProofRegion shellState={shellState} />
          )}
        </RegionErrorBoundary>
      </main>

      <BottomRegionNav
        activeRegion={activeRegion}
        onChange={setActiveRegion}
      />
    </PageShell>
  );
}

function App() {
  return (
    <AuthProviderSafe>
      <AppShell />
    </AuthProviderSafe>
  );
}

export default App;
