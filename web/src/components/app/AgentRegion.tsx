import type { ShellState } from "../../hooks/useShellState";
import { useAuthContext } from "../../hooks/useAuthContext";
import type { LinkedAgent } from "../../api/social";

type AgentRegionProps = {
  shellState: ShellState;
};

// ─── Intro card variants per shell state ────────────────────────────────────

function IntroPublic() {
  return (
    <div className="region-intro-card">
      <p className="region-intro-kicker">Agent</p>
      <h1 className="region-intro-title">
        Agent is where your sovereign AI works quietly on your behalf.
      </h1>
      <p className="region-intro-copy">
        This region is the private command center for agent work — task
        execution, fleet management, memory, and permissions. It is distinct
        from the social layer. Sign in to access your agent workspace.
      </p>
    </div>
  );
}

function IntroSignedOut() {
  return (
    <div className="region-intro-card">
      <p className="region-intro-kicker">Agent</p>
      <h1 className="region-intro-title">
        Sign in to access your agent workspace.
      </h1>
      <p className="region-intro-copy">
        Your agent workspace is where sovereign AI does real work. Sign in to
        get started.
      </p>
    </div>
  );
}

function IntroProfileMissing() {
  return (
    <div className="region-intro-card">
      <p className="region-intro-kicker">Agent</p>
      <h1 className="region-intro-title">
        Create your profile to activate agent features.
      </h1>
      <p className="region-intro-copy">
        Agent features are tied to your identity. Create your profile on the
        Home screen to unlock this workspace.
      </p>
    </div>
  );
}

function IntroReady({ viewerLabel }: { viewerLabel?: string }) {
  const greeting = viewerLabel
    ? `Your quiet workspace, ${viewerLabel}.`
    : "Your quiet workspace.";
  return (
    <div className="region-intro-card">
      <p className="region-intro-kicker">Agent</p>
      <h1 className="region-intro-title">{greeting}</h1>
      <p className="region-intro-copy">
        This is the command center for your agent work. Fleet management,
        tasks, memory, and permissions — all in one focused place.
      </p>
    </div>
  );
}

// ─── Auth-aware banners ─────────────────────────────────────────────────────

function SignInBanner() {
  return (
    <div className="agent-auth-banner agent-auth-banner-signin">
      <p>Sign in to access your agent workspace.</p>
    </div>
  );
}

function ProfileMissingBanner() {
  return (
    <div className="agent-auth-banner agent-auth-banner-profile">
      <p>
        Create your profile to activate agent features.{" "}
        <span className="agent-auth-banner-hint">
          Profile creation is available on the Home screen.
        </span>
      </p>
    </div>
  );
}

// ─── Loading skeleton ───────────────────────────────────────────────────────

function LoadingIntroSkeleton() {
  return (
    <div className="region-intro-card region-intro-card-compact" aria-busy="true">
      <div
        className="skeleton"
        style={{ width: "60px", height: "0.85em", borderRadius: "3px", marginBottom: "6px" }}
      />
      <div
        className="skeleton"
        style={{ width: "80%", height: "1.4em", borderRadius: "3px" }}
      />
    </div>
  );
}

function LoadingContentSkeleton() {
  return (
    <div className="agent-loading-skeleton" aria-busy="true">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="agent-blocked-card">
          <div
            className="skeleton"
            style={{ width: "40%", height: "1em", borderRadius: "3px", marginBottom: "8px" }}
          />
          <div
            className="skeleton"
            style={{ width: "100%", height: "2.4em", borderRadius: "3px" }}
          />
        </div>
      ))}
    </div>
  );
}

// ─── Fleet / Linked Agents panel ────────────────────────────────────────────

function AgentFleetCard({ agent }: { agent: LinkedAgent }) {
  return (
    <article className="agent-fleet-card">
      <div className="agent-fleet-card-header">
        <div className="agent-fleet-card-avatar" aria-hidden="true">
          {agent.agentName.charAt(0).toUpperCase()}
        </div>
        <div className="agent-fleet-card-info">
          <strong className="agent-fleet-card-name">{agent.agentName}</strong>
          <span className="agent-fleet-card-slug">/{agent.agentSlug}</span>
        </div>
        {agent.isPrimary && (
          <span className="agent-fleet-card-primary-badge">Primary</span>
        )}
      </div>
      <div className="agent-fleet-card-meta">
        <span className="agent-fleet-card-tag">{agent.agentType}</span>
        <span className="agent-fleet-card-tag">{agent.linkState}</span>
        <span className="agent-fleet-card-tag">{agent.visibility}</span>
      </div>
    </article>
  );
}

function FleetPanel({ linkedAgents }: { linkedAgents: LinkedAgent[] }) {
  return (
    <section className="agent-section">
      <h2 className="agent-section-title">Fleet / Linked Agents</h2>
      {linkedAgents.length > 0 ? (
        <div className="agent-fleet-grid">
          {linkedAgents.map((agent) => (
            <AgentFleetCard key={agent.id} agent={agent} />
          ))}
        </div>
      ) : (
        <div className="agent-empty-state">
          <p>No agents linked to your profile yet.</p>
        </div>
      )}
      <div className="agent-blocked-card agent-blocked-card-accent">
        <strong className="agent-blocked-card-title">Link Agent</strong>
        <p className="agent-blocked-card-copy">
          Linking an agent requires a Soma session. This will be available when
          Soma contracts are live.
        </p>
      </div>
    </section>
  );
}

// ─── Blocked sections ───────────────────────────────────────────────────────

function WorkActivitySection() {
  return (
    <section className="agent-section">
      <h2 className="agent-section-title">Work & Activity</h2>
      <div className="agent-blocked-card">
        <strong className="agent-blocked-card-title">Activity feed</strong>
        <p className="agent-blocked-card-copy">
          Recent agent work and activity will appear here once task contracts
          are live.
        </p>
      </div>
    </section>
  );
}

function MemoryTeachingSection() {
  return (
    <section className="agent-section">
      <h2 className="agent-section-title">Memory & Teaching</h2>
      <div className="agent-blocked-card">
        <strong className="agent-blocked-card-title">Teaching controls</strong>
        <p className="agent-blocked-card-copy">
          Agent memory and teaching controls require Vera runtime integration.
        </p>
      </div>
    </section>
  );
}

function MembranePermissionsSection() {
  return (
    <section className="agent-section">
      <h2 className="agent-section-title">Membrane & Permissions</h2>
      <div className="agent-blocked-card">
        <strong className="agent-blocked-card-title">Permission controls</strong>
        <p className="agent-blocked-card-copy">
          Agent membrane and permission controls will be available with Soma
          contracts.
        </p>
      </div>
    </section>
  );
}

// ─── Sidebar ────────────────────────────────────────────────────────────────

function SidebarAgentStatus({ linkedAgents }: { linkedAgents: LinkedAgent[] }) {
  return (
    <div className="agent-sidebar-status">
      <p className="agent-sidebar-section-title">Agent Status</p>
      {linkedAgents.length > 0 ? (
        <ul className="agent-sidebar-list">
          {linkedAgents.map((a) => (
            <li key={a.id} className="agent-sidebar-list-item">
              <span className="agent-sidebar-list-avatar" aria-hidden="true">
                {a.agentName.charAt(0).toUpperCase()}
              </span>
              <span className="agent-sidebar-list-name">{a.agentName}</span>
              <span className="agent-sidebar-list-state">{a.linkState}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="agent-sidebar-empty">No fleet linked yet.</p>
      )}
    </div>
  );
}

function SidebarRegionInfo() {
  return (
    <div className="agent-sidebar-info">
      <p className="agent-sidebar-section-title">About this region</p>
      <p className="agent-sidebar-info-copy">
        Agent is the quiet work mode for your sovereign agent life. No social
        feed, no community content — just focused workspace for fleet
        management, task execution, memory, and permissions.
      </p>
    </div>
  );
}

// ─── Component ──────────────────────────────────────────────────────────────

export function AgentRegion({ shellState }: AgentRegionProps) {
  const { linkedAgents, myProfile } = useAuthContext();

  const showAuthBanner =
    shellState === "public" || shellState === "signed_out";
  const showProfileBanner = shellState === "profile_missing";
  const showLoading = shellState === "loading";
  const showReady = shellState === "ready";

  const viewerLabel = myProfile?.profile.displayName;

  return (
    <div className="region-layout">
      <section className="region-main">
        {/* Intro card — varies by shell state */}
        {showLoading ? (
          <LoadingIntroSkeleton />
        ) : (
          <>
            {shellState === "public" && <IntroPublic />}
            {shellState === "signed_out" && <IntroSignedOut />}
            {shellState === "profile_missing" && <IntroProfileMissing />}
            {showReady && <IntroReady viewerLabel={viewerLabel} />}
          </>
        )}

        {/* Auth-aware banners */}
        {showAuthBanner && <SignInBanner />}
        {showProfileBanner && <ProfileMissingBanner />}

        {/* Loading skeleton */}
        {showLoading && <LoadingContentSkeleton />}

        {/* Ready state content */}
        {showReady && (
          <>
            <FleetPanel linkedAgents={linkedAgents} />
            <WorkActivitySection />
            <MemoryTeachingSection />
            <MembranePermissionsSection />
          </>
        )}
      </section>

      <aside className="region-side">
        {showLoading ? (
          <div className="agent-sidebar-status" aria-busy="true">
            <p className="agent-sidebar-section-title">Agent Status</p>
            <div
              className="skeleton"
              style={{ height: "2em", borderRadius: "3px" }}
            />
          </div>
        ) : (
          <>
            <SidebarAgentStatus linkedAgents={showReady ? linkedAgents : []} />
            <SidebarRegionInfo />
          </>
        )}
      </aside>
    </div>
  );
}
