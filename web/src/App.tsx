import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { Routes, Route, Navigate, useNavigate, useLocation } from "react-router-dom";
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
import { VeraSocials } from "./components/app/VeraSocials";
import { RegionPlaceholder } from "./components/app/RegionPlaceholder";
import { RegionRail } from "./components/app/RegionRail";
import { TopContextBar } from "./components/app/TopContextBar";
import SettingsPage from "./components/settings/SettingsPage";

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

const REGION_FROM_PATH: Record<string, AppRegion> = {
  "": "social",
  feed: "social",
  profiles: "social",
  communities: "social",
  longform: "social",
  pulse: "social",
  you: "social",
  profile: "social",
  community: "social",
  post: "social",
  identity: "identity",
  agent: "agent",
  market: "market",
  proof: "proof",
  settings: "social",
  notifications: "social",
};

function useActiveRegion(): AppRegion {
  const { pathname } = useLocation();
  const segment = pathname.split("/")[1] || "";
  return REGION_FROM_PATH[segment] ?? "social";
}

function useRegionNavigate() {
  const navigate = useNavigate();
  return (region: AppRegion) => {
    navigate(region === "social" ? "/" : `/${region}`);
  };
}

const MarketPlaceholder = () => (
  <RegionPlaceholder
    region="market"
    title="Market needs real launch, work, package, and bounty contracts."
    intro="The region shape is clear, but we are not going to fake trust-pool participation or marketplace behavior. This stays an honest scaffold until Vera and Soma lock the primitives."
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
);

const ProofPlaceholder = () => (
  <RegionPlaceholder
    region="proof"
    title="Proof is the legibility layer, but the substrate truth still belongs upstream."
    intro="This region will hold trust weather, lineage, growth, and archive views. We can scaffold the drawer patterns now, but the real proof objects need Soma contracts."
    sections={[
      {
        label: "Ready now",
        items: [
          "Proof region shell",
          "Overview, Lineage, Trust, Growth, and Archive nav",
          "View-proof entry patterns",
        ],
      },
      {
        label: "Blocked on Soma",
        items: [
          "Proof snapshots and verification layers",
          "Continuity and trust history",
          "Recovery-linked trust states",
          "RootWeave and archive data surfaces",
        ],
      },
    ]}
  />
);

function AppShell() {
  const activeRegion = useActiveRegion();
  const navigateRegion = useRegionNavigate();
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
        onChange={navigateRegion}
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
          <Routes>
            <Route path="/" element={<VeraSocials shellState={shellState} />} />
            <Route path="/feed" element={<VeraSocials shellState={shellState} />} />
            <Route path="/profiles" element={<VeraSocials shellState={shellState} />} />
            <Route path="/communities" element={<VeraSocials shellState={shellState} />} />
            <Route path="/longform" element={<VeraSocials shellState={shellState} />} />
            <Route path="/pulse" element={<VeraSocials shellState={shellState} />} />
            <Route path="/you" element={<VeraSocials shellState={shellState} />} />
            <Route path="/profile/:handle" element={<VeraSocials shellState={shellState} />} />
            <Route path="/community/:slug" element={<VeraSocials shellState={shellState} />} />
            <Route path="/post/:id" element={<VeraSocials shellState={shellState} />} />
            <Route path="/identity" element={<IdentityRegion shellState={shellState} />} />
            <Route path="/agent" element={<AgentRegion shellState={shellState} />} />
            <Route path="/market" element={<MarketPlaceholder />} />
            <Route path="/proof" element={<ProofPlaceholder />} />
            <Route path="/settings/*" element={<SettingsPage shellState={shellState} />} />
            <Route path="/notifications" element={<VeraSocials shellState={shellState} />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </RegionErrorBoundary>
      </main>

      <BottomRegionNav
        activeRegion={activeRegion}
        onChange={navigateRegion}
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
