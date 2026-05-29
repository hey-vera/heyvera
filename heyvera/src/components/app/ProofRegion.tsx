import type { ShellState } from "../../hooks/useShellState";
import { useAuthContext } from "../../hooks/useAuthContext";
import type { LinkedAgent, Profile } from "../../api/social";

function formatState(value: string | null | undefined) {
  if (!value) return "Pending";
  return value.replace(/_/g, " ");
}

function proofSummary(profile: Profile | null) {
  if (!profile) return { label: "No profile proof state", live: false };
  if (profile.proofState === "verified" && profile.continuityState === "verified") {
    return { label: "Proof + continuity verified", live: true };
  }
  if (profile.proofState === "verified") {
    return { label: "Proof recorded, continuity pending", live: false };
  }
  return { label: "Verification pending", live: false };
}

function shellProofLabel(shellState: ShellState, profile: Profile | null) {
  if (shellState === "public") return "Public proof preview";
  if (shellState === "signed_out") return "Sign in to view proof state";
  if (shellState === "loading") return "Loading proof state";
  if (shellState === "profile_missing") return "Profile needed";
  return proofSummary(profile).label;
}

function ProofSignalCard({
  label,
  value,
  detail,
  live,
}: {
  label: string;
  value: string;
  detail: string;
  live: boolean;
}) {
  return (
    <article className="proof-signal-card">
      <div className="proof-signal-card-header">
        <span className={`proof-signal-dot${live ? " proof-signal-dot-live" : ""}`} aria-hidden="true" />
        <span>{label}</span>
      </div>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  );
}

function ProofOverview({
  shellState,
  profile,
  linkedAgents,
}: {
  shellState: ShellState;
  profile: Profile | null;
  linkedAgents: LinkedAgent[];
}) {
  const summary = proofSummary(profile);
  const verifiedAgents = linkedAgents.filter((agent) => agent.proofState === "verified").length;

  return (
    <section className="proof-overview" aria-label="Proof overview">
      <div className="proof-overview-copy">
        <p className="region-summary-label">Proof Nearby</p>
        <h1>Receipts, lineage, and trust state should stay readable next to the work.</h1>
        <p>
          HeyVera can show profile proof labels and linked-agent proof signals now.
          Full receipt ledgers, lineage graphs, recovery history, and Soma-native
          verification remain explicitly blocked until upstream contracts are ready.
        </p>
      </div>
      <div className="proof-orb" aria-label={shellProofLabel(shellState, profile)}>
        <span className={`proof-orb-ring${summary.live ? " proof-orb-ring-live" : ""}`} aria-hidden="true" />
        <strong>{shellProofLabel(shellState, profile)}</strong>
        <span>{verifiedAgents} linked agent proof label{verifiedAgents === 1 ? "" : "s"}</span>
      </div>
    </section>
  );
}

function ProofSignals({
  profile,
  linkedAgents,
  loading,
}: {
  profile: Profile | null;
  linkedAgents: LinkedAgent[];
  loading: boolean;
}) {
  const summary = proofSummary(profile);
  const primaryAgent = linkedAgents.find((agent) => agent.isPrimary) ?? linkedAgents[0];

  if (loading) {
    return (
      <section className="proof-section">
        <h2 className="proof-section-title">Visible Signals</h2>
        <div className="proof-signal-grid" aria-busy="true">
          {["Profile proof", "Continuity", "Primary agent", "Receipt ledger"].map((label) => (
            <ProofSignalCard
              key={label}
              label={label}
              value="Loading"
              detail="Waiting for the signed-in shell to resolve current state."
              live={false}
            />
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="proof-section">
      <h2 className="proof-section-title">Visible Signals</h2>
      <div className="proof-signal-grid">
        <ProofSignalCard
          label="Profile proof"
          value={summary.label}
          detail={profile ? `Profile @${profile.handle}` : "Create a profile before account proof can be shown."}
          live={summary.live}
        />
        <ProofSignalCard
          label="Continuity"
          value={profile ? formatState(profile.continuityState) : "Pending"}
          detail="Continuity is shown from current profile state, not inferred from auth alone."
          live={profile?.continuityState === "verified"}
        />
        <ProofSignalCard
          label="Primary agent"
          value={primaryAgent ? primaryAgent.agentName : "Not linked"}
          detail={primaryAgent ? `Agent proof label: ${formatState(primaryAgent.proofState)}` : "Agent proof appears after an agent link exists."}
          live={primaryAgent?.proofState === "verified"}
        />
        <ProofSignalCard
          label="Receipt ledger"
          value="Not live yet"
          detail="Action receipts need Soma proof contracts before they can be shown as real history."
          live={false}
        />
      </div>
    </section>
  );
}

function ProofLineage() {
  const steps = [
    ["Identity", "Profile and account session establish who is operating."],
    ["Agent", "Linked agents make delegated work visible without hiding the human operator."],
    ["Work", "Posts, drafts, and future tasks should carry source and author context."],
    ["Receipt", "Soma-native proof receipts are blocked until contracts expose stable objects."],
  ];

  return (
    <section className="proof-section">
      <h2 className="proof-section-title">Lineage Path</h2>
      <div className="proof-lineage">
        {steps.map(([title, copy], index) => (
          <div key={title} className="proof-lineage-step">
            <span className="proof-lineage-index">{index + 1}</span>
            <div>
              <strong>{title}</strong>
              <p>{copy}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ProofBlockedGates() {
  const gates = [
    ["Receipt objects", "Need Soma contracts and event shape."],
    ["Lineage graph", "Needs durable source, post, and agent references."],
    ["Recovery history", "Needs ceremony and recovery primitives."],
    ["Trust weather", "Needs verified signals before scoring is meaningful."],
  ];

  return (
    <section className="proof-section">
      <h2 className="proof-section-title">Blocked Honestly</h2>
      <div className="proof-gate-grid">
        {gates.map(([title, copy]) => (
          <div key={title} className="proof-gate-card">
            <strong>{title}</strong>
            <p>{copy}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function ProofSidebar({
  profile,
  linkedAgents,
  loading,
}: {
  profile: Profile | null;
  linkedAgents: LinkedAgent[];
  loading: boolean;
}) {
  return (
    <aside className="region-side proof-side">
      <div className="proof-side-card">
        <p className="proof-side-title">Current source</p>
        <strong>{loading ? "Loading profile" : profile ? `@${profile.handle}` : "No profile yet"}</strong>
        <span>{loading ? "Resolving proof state" : profile ? proofSummary(profile).label : "Create profile first"}</span>
      </div>
      <div className="proof-side-card">
        <p className="proof-side-title">Agent proof labels</p>
        {linkedAgents.length > 0 ? (
          <div className="proof-side-list">
            {linkedAgents.map((agent) => (
              <div key={agent.id} className="proof-side-list-row">
                <span>{agent.agentName}</span>
                <strong>{formatState(agent.proofState)}</strong>
              </div>
            ))}
          </div>
        ) : (
          <span>No linked agents yet.</span>
        )}
      </div>
      <div className="proof-side-card">
        <p className="proof-side-title">Posture</p>
        <span>Your agent first, proof nearby, network additive, markets contained.</span>
      </div>
    </aside>
  );
}

export function ProofRegion({ shellState }: { shellState: ShellState }) {
  const { myProfile, linkedAgents } = useAuthContext();
  const profile = myProfile?.profile ?? null;
  const loading = shellState === "loading";

  return (
    <div className="region-layout proof-region">
      <section className="region-main proof-main">
        <ProofOverview shellState={shellState} profile={profile} linkedAgents={linkedAgents} />
        <ProofSignals profile={profile} linkedAgents={linkedAgents} loading={loading} />
        <ProofLineage />
        <ProofBlockedGates />
      </section>
      <ProofSidebar profile={profile} linkedAgents={linkedAgents} loading={loading} />
    </div>
  );
}
