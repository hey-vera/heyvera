import { useState } from "react";
import { useAuthContext } from "../../hooks/useAuthContext";
import { useCredentialRoster } from "../../hooks/useCredentialRoster";
import { usePendingCeremonies } from "../../hooks/usePendingCeremonies";
import { UpdateProfileForm } from "../shared/UpdateProfileForm";
import { LinkAgentForm } from "../shared/LinkAgentForm";
import type { Profile, LinkedAgent } from "../../api/social";

type IdentityTab = "overview" | "profile" | "credentials" | "delegation";

const TAB_LABELS: { key: IdentityTab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "profile", label: "Profile" },
  { key: "credentials", label: "Credentials" },
  { key: "delegation", label: "Delegation" },
];

// ─── Overview tab ────────────────────────────────────────────────────────────

function OverviewTab() {
  const { isSignedIn, viewerLabel, myProfile, linkedAgents, myProfileLoading } =
    useAuthContext();

  if (!isSignedIn) {
    return (
      <div className="identity-state-card">
        <p className="identity-state-title">Not signed in</p>
        <p className="identity-state-body">
          Sign in to see your identity and account state.
        </p>
      </div>
    );
  }

  if (myProfileLoading) {
    return <p className="identity-loading">Loading identity state…</p>;
  }

  const profile = myProfile?.profile ?? null;

  return (
    <div className="identity-overview">
      <div className="identity-overview-account">
        <span className="region-intro-kicker">Account</span>
        <p className="identity-overview-name">
          {viewerLabel ?? profile?.displayName ?? "Vera member"}
        </p>
        {profile ? (
          <>
            <p className="identity-overview-handle">@{profile.handle}</p>
            {profile.bio && (
              <p className="identity-overview-bio">{profile.bio}</p>
            )}
          </>
        ) : (
          <p className="identity-state-body">
            No social profile yet. Set one up in the Profile tab.
          </p>
        )}
      </div>

      {linkedAgents.length > 0 && (
        <div className="identity-overview-agents">
          <span className="region-intro-kicker">Linked agents</span>
          <ul className="identity-agent-list">
            {linkedAgents.map((agent) => (
              <li key={agent.id} className="identity-agent-row">
                <span className="identity-agent-name">{agent.agentName}</span>
                <span className="identity-agent-meta">
                  {agent.agentSlug} · {agent.agentType} ·{" "}
                  <span
                    className={
                      agent.linkState === "verified"
                        ? "identity-badge identity-badge-ok"
                        : "identity-badge"
                    }
                  >
                    {agent.linkState}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ─── Profile tab ─────────────────────────────────────────────────────────────

function ProfileTab() {
  const { isSignedIn, myProfile, getToken, refetchMyProfile } =
    useAuthContext();
  const [showLinkForm, setShowLinkForm] = useState(false);

  if (!isSignedIn) {
    return (
      <div className="identity-state-card">
        <p className="identity-state-title">Not signed in</p>
      </div>
    );
  }

  if (!myProfile) {
    return (
      <div className="identity-state-card">
        <p className="identity-state-title">No profile found</p>
        <p className="identity-state-body">
          Create a social profile to start building your presence.
        </p>
      </div>
    );
  }

  function handleProfileSaved(updated: Profile) {
    void updated;
    refetchMyProfile();
  }

  function handleAgentLinked(agent: LinkedAgent) {
    void agent;
    setShowLinkForm(false);
    refetchMyProfile();
  }

  return (
    <div className="identity-profile-tab">
      <div className="identity-section">
        <h3 className="identity-section-title">Edit profile</h3>
        <UpdateProfileForm
          profile={myProfile.profile}
          getToken={getToken}
          onSaved={handleProfileSaved}
        />
      </div>

      <div className="identity-section">
        <div className="identity-section-header">
          <h3 className="identity-section-title">Linked agents</h3>
          {!showLinkForm && (
            <button
              type="button"
              className="button button-outline identity-section-action"
              onClick={() => setShowLinkForm(true)}
            >
              + Link agent
            </button>
          )}
        </div>
        {showLinkForm && (
          <LinkAgentForm
            getToken={getToken}
            onLinked={handleAgentLinked}
            onCancel={() => setShowLinkForm(false)}
          />
        )}
      </div>
    </div>
  );
}

// ─── Credentials tab ─────────────────────────────────────────────────────────

function CredentialsTab() {
  const rosterState = useCredentialRoster();
  const ceremoniesState = usePendingCeremonies();

  return (
    <div className="identity-credentials-tab">
      <div className="identity-section">
        <h3 className="identity-section-title">Authenticator roster</h3>
        {rosterState.status === "loading" && (
          <p className="identity-loading">Loading roster…</p>
        )}
        {rosterState.status === "error" && (
          <div className="identity-state-card">
            <p className="identity-state-title">Roster not available</p>
            <p className="identity-state-body">
              Credential management requires an authenticator session, not
              available from a standard browser context.
            </p>
          </div>
        )}
        {rosterState.status === "ok" && rosterState.roster.length === 0 && (
          <p className="identity-empty">No authenticators registered.</p>
        )}
        {rosterState.status === "ok" && rosterState.roster.length > 0 && (
          <ul className="identity-roster-list">
            {rosterState.roster.map((entry) => (
              <li key={entry.id} className="identity-roster-row">
                <div className="identity-roster-meta">
                  <span className="identity-roster-ecosystem">
                    {entry.ecosystem}
                  </span>
                  <span
                    className={`identity-badge ${entry.status === "active" ? "identity-badge-ok" : "identity-badge-muted"}`}
                  >
                    {entry.role} · {entry.status}
                  </span>
                </div>
                <span className="identity-roster-date">
                  Registered{" "}
                  {new Date(entry.created_at).toLocaleDateString()}
                  {entry.last_used_at && (
                    <>
                      {" · "}Last used{" "}
                      {new Date(entry.last_used_at).toLocaleDateString()}
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="identity-section">
        <h3 className="identity-section-title">Pending ceremonies</h3>
        {ceremoniesState.status === "loading" && (
          <p className="identity-loading">Loading ceremonies…</p>
        )}
        {ceremoniesState.status === "error" && (
          <div className="identity-state-card">
            <p className="identity-state-title">Ceremonies not available</p>
            <p className="identity-state-body">
              Ceremony state requires an authenticator session, not available
              from a standard browser context.
            </p>
          </div>
        )}
        {ceremoniesState.status === "ok" &&
          ceremoniesState.ceremonies.length === 0 && (
            <p className="identity-empty">No pending ceremonies.</p>
          )}
        {ceremoniesState.status === "ok" &&
          ceremoniesState.ceremonies.length > 0 && (
            <ul className="identity-ceremony-list">
              {ceremoniesState.ceremonies.map((c) => (
                <li key={c.id} className="identity-ceremony-row">
                  <div className="identity-ceremony-pkg">
                    {c.package_name}
                    <span className="identity-ceremony-version">
                      {" "}
                      {c.target_version}
                    </span>
                  </div>
                  <div className="identity-ceremony-meta">
                    <span
                      className={`identity-badge ${c.status === "awaiting_webauthn" ? "identity-badge-warn" : "identity-badge-muted"}`}
                    >
                      {c.status}
                    </span>
                    <span className="identity-roster-date">
                      Expires{" "}
                      {new Date(c.expires_at).toLocaleDateString()}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
      </div>
    </div>
  );
}

// ─── Delegation tab ───────────────────────────────────────────────────────────

function DelegationTab() {
  return (
    <div className="identity-section">
      <div className="identity-state-card identity-state-card-blocked">
        <span className="region-intro-kicker">Blocked</span>
        <p className="identity-state-title">
          Delegation key controls not available here
        </p>
        <p className="identity-state-body">
          Issuing and revoking delegation keys requires a root API key
          (X-API-Key: cn-xxx), which is a server-held credential — not a
          browser Bearer token. This surface will become available once
          Soma-native authority issuance is wired end-to-end.
        </p>
        <p className="identity-state-body">
          To manage delegation keys today, use the admin dashboard or the
          economy API directly with your root key.
        </p>
      </div>
    </div>
  );
}

// ─── Identity region root ─────────────────────────────────────────────────────

export function IdentityRegion() {
  const [activeTab, setActiveTab] = useState<IdentityTab>("overview");

  return (
    <div className="region-layout">
      <div className="region-main">
        <div className="region-intro-card">
          <span className="region-intro-kicker">Identity</span>
          <h2 className="region-intro-title">Your continuity and authority</h2>
          <p className="region-intro-copy">
            Account state, profile, linked agents, authenticator roster, and
            ceremony state. Delegation controls are blocked until Soma-native
            authority issuance is production-wired.
          </p>
        </div>

        <nav className="region-subnav" aria-label="Identity sections">
          {TAB_LABELS.map((t) => (
            <button
              key={t.key}
              type="button"
              className={`region-subnav-item${activeTab === t.key ? " region-subnav-item-active" : ""}`}
              onClick={() => setActiveTab(t.key)}
              aria-current={activeTab === t.key ? "page" : undefined}
            >
              {t.label}
            </button>
          ))}
        </nav>

        {activeTab === "overview" && <OverviewTab />}
        {activeTab === "profile" && <ProfileTab />}
        {activeTab === "credentials" && <CredentialsTab />}
        {activeTab === "delegation" && <DelegationTab />}
      </div>
    </div>
  );
}
