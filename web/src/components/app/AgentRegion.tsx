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
        Your agent-first workspace is forming here.
      </h1>
      <p className="region-intro-copy">
        Agent is the focused work mode for HeyVera: human instruction, agent
        drafts, approvals, and proof-adjacent receipts. Sign in to make it yours.
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
        Your agent workspace will hold drafts, work queues, approvals, and
        receipt-ready actions once your identity is active.
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
    ? `Your agent workspace, ${viewerLabel}.`
    : "Your agent workspace.";
  return (
    <div className="region-intro-card">
      <p className="region-intro-kicker">Agent</p>
      <h1 className="region-intro-title">{greeting}</h1>
      <p className="region-intro-copy">
        This is the command center for human-agent collaboration: live linked
        agents where available, honest runtime gates where Vera and Soma are not wired yet.
      </p>
    </div>
  );
}

function formatAgentState(agent: LinkedAgent) {
  const state = agent.linkState.replace(/_/g, " ");
  return agent.isPrimary ? `Primary · ${state}` : state;
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
        <span className="agent-fleet-card-tag">{formatAgentState(agent)}</span>
        <span className="agent-fleet-card-tag">{agent.visibility}</span>
      </div>
    </article>
  );
}

function AgentCommandSurface({ linkedAgents }: { linkedAgents: LinkedAgent[] }) {
  const primaryAgent = linkedAgents.find((agent) => agent.isPrimary) ?? linkedAgents[0];

  return (
    <section className="agent-command-surface" aria-label="Agent command surface">
      <div className="agent-command-copy">
        <p className="region-summary-label">Command Surface</p>
        <h2>{primaryAgent ? `${primaryAgent.agentName} is linked, runtime pending.` : "No linked agent is ready yet."}</h2>
        <p>
          HeyVera can show agent identity and authority state today. Drafting,
          task execution, autonomous replies, and receipts remain gated until
          Vera runtime and Soma proof contracts are connected.
        </p>
      </div>
      <div className="agent-command-status-grid">
        <div className="agent-command-status-card agent-command-status-card-live">
          <span>Identity</span>
          <strong>{primaryAgent ? formatAgentState(primaryAgent) : "Pending"}</strong>
          <small>{primaryAgent ? `/${primaryAgent.agentSlug}` : "Link an agent after profile setup"}</small>
        </div>
        <div className="agent-command-status-card">
          <span>Runtime</span>
          <strong>Blocked</strong>
          <small>Vera execution loop is not wired in this frontend slice</small>
        </div>
        <div className="agent-command-status-card">
          <span>Proof</span>
          <strong>Nearby</strong>
          <small>Actions will need receipt objects before automation is live</small>
        </div>
      </div>
    </section>
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
  const workItems = [
    {
      title: "Draft social post",
      state: "Frontend shell",
      copy: "A future agent draft should wait for human approval before reaching the feed.",
    },
    {
      title: "Summarize network thread",
      state: "Runtime pending",
      copy: "Needs Vera runtime context and source references before it can become real work.",
    },
    {
      title: "Prepare proof receipt",
      state: "Soma pending",
      copy: "Receipt creation is blocked until proof contracts expose frontend-safe objects.",
    },
  ];

  return (
    <section className="agent-section">
      <h2 className="agent-section-title">Work Queue</h2>
      <div className="agent-work-queue">
        {workItems.map((item) => (
          <article key={item.title} className="agent-work-item">
            <div>
              <strong>{item.title}</strong>
              <p>{item.copy}</p>
            </div>
            <span>{item.state}</span>
          </article>
        ))}
      </div>
    </section>
  );
}

function ApprovalGatesSection() {
  const gates = [
    ["Human approval", "Required before public posts, replies, or market actions."],
    ["Agent authority", "Must resolve to a linked agent identity."],
    ["Proof receipt", "Must produce a receipt before autonomous execution goes live."],
    ["Runtime boundary", "Needs Vera execution and memory policy before real tasks run."],
  ];

  return (
    <section className="agent-section">
      <h2 className="agent-section-title">Approval Gates</h2>
      <div className="agent-gate-grid">
        {gates.map(([title, copy]) => (
          <div key={title} className="agent-gate-card">
            <strong>{title}</strong>
            <p>{copy}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function MemoryTeachingSection() {
  return (
    <section className="agent-section">
      <h2 className="agent-section-title">Memory, Teaching, and Membrane</h2>
      <div className="agent-blocked-card">
        <strong className="agent-blocked-card-title">Not live yet</strong>
        <p className="agent-blocked-card-copy">
          Agent memory, teaching controls, and permissions require Vera runtime
          policy plus Soma-backed delegation semantics. The frontend keeps this
          visible without presenting fake controls.
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
              <span className="agent-sidebar-list-state">{formatAgentState(a)}</span>
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
        Agent is the work mode: your agent first, proof nearby, network
        additive, markets contained. Real execution remains blocked until the
        runtime and proof contracts exist.
      </p>
    </div>
  );
}

function SidebarProofAdjacency() {
  return (
    <div className="agent-sidebar-info">
      <p className="agent-sidebar-section-title">Proof adjacency</p>
      <div className="agent-sidebar-proof-stack">
        <span>Drafts need human approval</span>
        <span>Actions need receipts</span>
        <span>Automation needs Soma gates</span>
      </div>
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
            <AgentCommandSurface linkedAgents={linkedAgents} />
            <FleetPanel linkedAgents={linkedAgents} />
            <WorkActivitySection />
            <ApprovalGatesSection />
            <MemoryTeachingSection />
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
            <SidebarProofAdjacency />
            <SidebarRegionInfo />
          </>
        )}
      </aside>
    </div>
  );
}
