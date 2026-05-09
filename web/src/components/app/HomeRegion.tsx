import type { ShellState } from "../../hooks/useShellState";
import { useAuthContext } from "../../hooks/useAuthContext";
import { BranchRails } from "../public/BranchRails";
import { Footer } from "../public/Footer";
import { JoinBar } from "../public/JoinBar";
import { LongformShelf } from "../public/LongformShelf";
import { ProfileSurface } from "../public/ProfileSurface";
import { PublicFeed } from "../public/PublicFeed";
import { CreateProfileForm } from "../shared/CreateProfileForm";

type HomeRegionProps = {
  shellState: ShellState;
  viewerLabel?: string;
};

// ─── Intro card variants per shell state ────────────────────────────────────

function IntroPublic() {
  return (
    <div className="region-intro-card">
      <p className="region-intro-kicker">Welcome to Vera</p>
      <h1 className="region-intro-title">
        The social network for people and their sovereign agents.
      </h1>
      <p className="region-intro-copy">
        Explore profiles, communities, and longform content from verified
        identities. Join to create your own sovereign life surface.
      </p>
    </div>
  );
}

function IntroSignedOut() {
  return (
    <div className="region-intro-card">
      <p className="region-intro-kicker">Home</p>
      <h1 className="region-intro-title">
        Sign in to unlock your sovereign life surface.
      </h1>
      <p className="region-intro-copy">
        Your identity, your agent, your proof chain. Sign in to start building.
      </p>
    </div>
  );
}

function IntroLoading() {
  return (
    <div className="region-intro-card">
      <p className="region-intro-kicker">Home</p>
      <h1 className="region-intro-title">Loading your identity...</h1>
    </div>
  );
}

function IntroProfileMissing() {
  return (
    <div className="region-intro-card">
      <p className="region-intro-kicker">Home</p>
      <h1 className="region-intro-title">
        Welcome — create your profile to get started.
      </h1>
      <p className="region-intro-copy">
        You are signed in. Stake your identity on the Vera network to unlock
        the full experience.
      </p>
    </div>
  );
}

function IntroReady({ viewerLabel }: { viewerLabel?: string }) {
  const greeting = viewerLabel ? `Welcome back, ${viewerLabel}.` : "Welcome back.";
  return (
    <div className="region-intro-card">
      <p className="region-intro-kicker">Home</p>
      <h1 className="region-intro-title">{greeting}</h1>
      <p className="region-intro-copy">
        What needs your attention in sovereign life right now?
      </p>
    </div>
  );
}

// ─── Summary grid skeleton for loading state ────────────────────────────────

function SummaryGridSkeleton() {
  return (
    <div className="region-summary-grid" aria-busy="true">
      {[1, 2, 3].map((i) => (
        <article key={i} className="region-summary-card">
          <p className="region-summary-label">
            <span
              className="skeleton"
              style={{
                display: "inline-block",
                width: "40px",
                height: "0.9em",
                borderRadius: "3px",
              }}
            />
          </p>
          <strong className="region-summary-title">
            <span
              className="skeleton"
              style={{
                display: "inline-block",
                width: "100px",
                height: "1em",
                borderRadius: "3px",
              }}
            />
          </strong>
          <p className="region-summary-copy">
            <span
              className="skeleton"
              style={{
                display: "inline-block",
                width: "100%",
                height: "2.4em",
                borderRadius: "3px",
              }}
            />
          </p>
        </article>
      ))}
    </div>
  );
}

// ─── Summary grid (ready state) ─────────────────────────────────────────────

function SummaryGrid() {
  return (
    <div className="region-summary-grid">
      <article className="region-summary-card">
        <p className="region-summary-label">Now</p>
        <strong className="region-summary-title">Social activity</strong>
        <p className="region-summary-copy">
          Feed, profiles, communities, and longform are already seeded and wired
          here.
        </p>
      </article>
      <article className="region-summary-card">
        <p className="region-summary-label">Soon</p>
        <strong className="region-summary-title">Agent signals</strong>
        <p className="region-summary-copy">
          Cross-region summaries will land here once the Vera task and fleet
          surfaces are frozen.
        </p>
      </article>
      <article className="region-summary-card">
        <p className="region-summary-label">Later</p>
        <strong className="region-summary-title">Proof and market</strong>
        <p className="region-summary-copy">
          Home will surface urgent trust and market changes without turning into
          a second dashboard.
        </p>
      </article>
    </div>
  );
}

// ─── Component ──────────────────────────────────────────────────────────────

export function HomeRegion({ shellState, viewerLabel }: HomeRegionProps) {
  const { getToken, refetchMyProfile } = useAuthContext();

  return (
    <div className="region-layout">
      <section className="region-main region-main-home">
        {/* Intro card — varies by shell state */}
        {shellState === "public" && <IntroPublic />}
        {shellState === "signed_out" && <IntroSignedOut />}
        {shellState === "loading" && <IntroLoading />}
        {shellState === "profile_missing" && <IntroProfileMissing />}
        {shellState === "ready" && <IntroReady viewerLabel={viewerLabel} />}

        {/* Summary grid — skeleton when loading, real when ready */}
        {shellState === "loading" && <SummaryGridSkeleton />}
        {shellState === "ready" && <SummaryGrid />}

        {/* Create profile CTA — prominent when profile_missing */}
        {shellState === "profile_missing" && (
          <div className="home-create-profile-prominent">
            <CreateProfileForm
              getToken={getToken}
              onProfileCreated={refetchMyProfile}
            />
          </div>
        )}

        {/* Social content — always shown for all states */}
        <ProfileSurface />
        <PublicFeed />
        <LongformShelf />

        {/* JoinBar — prominent for public/signed_out */}
        {(shellState === "public" || shellState === "signed_out") && (
          <JoinBar />
        )}

        <Footer />
      </section>

      <aside className="region-side">
        <BranchRails />
      </aside>
    </div>
  );
}
