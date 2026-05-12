import type { ShellState } from "../../hooks/useShellState";
import { useAuthContext } from "../../hooks/useAuthContext";

function formatDate(value: string | null | undefined) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not recorded";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function normalizeState(value: string | null | undefined) {
  if (!value) return "Pending";
  return value.replace(/_/g, " ");
}

function shellContinuityLabel(shellState: ShellState) {
  if (shellState === "public") return "Public preview";
  if (shellState === "signed_out") return "Signed out";
  if (shellState === "loading") return "Loading";
  if (shellState === "profile_missing") return "Profile needed";
  return "Continuity active";
}

export function IdentityRegion({ shellState }: { shellState: ShellState }) {
  const {
    authEnabled,
    isSignedIn,
    viewerLabel,
    myProfile,
    myProfileLoading,
    myProfileNotFound,
    linkedAgents,
  } = useAuthContext();
  const profile = myProfile?.profile ?? null;
  const primaryAgent = linkedAgents.find((agent) => agent.isPrimary) ?? linkedAgents[0];

  return (
    <div className="identity-region">
      <section className="identity-hero">
        <div className="identity-hero-copy">
          <p className="region-intro-kicker">Identity Lite</p>
          <h1 className="identity-hero-title">
            Your continuity state, without pretending the full Soma-native stack is finished.
          </h1>
          <p className="identity-hero-text">
            HeyVera can show the account, profile, linked-agent, proof, and ceremony signals that exist today. Deeper credentials stay explicit until the upstream trust contracts are real.
          </p>
        </div>
        <div className="identity-continuity-orb" aria-label={shellContinuityLabel(shellState)}>
          <span className="identity-continuity-ring" aria-hidden="true" />
          <strong>{shellContinuityLabel(shellState)}</strong>
          <span>{authEnabled ? "Auth-aware shell" : "Public mode"}</span>
        </div>
      </section>

      <div className="identity-grid">
        <section className="identity-card identity-profile-card">
          <div className="identity-card-header">
            <p className="region-summary-label">Profile</p>
            <span className={`identity-status-pill identity-status-${shellState}`}>
              {shellContinuityLabel(shellState)}
            </span>
          </div>

          {myProfileLoading ? (
            <div className="identity-empty">Loading profile state.</div>
          ) : profile ? (
            <>
              <div className="identity-profile-lockup">
                <div className="identity-avatar" aria-hidden="true">
                  {(profile.displayName || profile.handle || "V").charAt(0).toUpperCase()}
                </div>
                <div>
                  <h2 className="identity-profile-name">{profile.displayName}</h2>
                  <p className="identity-profile-handle">@{profile.handle}</p>
                </div>
              </div>
              <p className="identity-profile-bio">
                {profile.bio || "No public profile note has been set yet."}
              </p>
              <dl className="identity-fact-grid">
                <div>
                  <dt>Continuity</dt>
                  <dd>{normalizeState(profile.continuityState)}</dd>
                </div>
                <div>
                  <dt>Proof</dt>
                  <dd>{normalizeState(profile.proofState)}</dd>
                </div>
                <div>
                  <dt>Created</dt>
                  <dd>{formatDate(profile.createdAt)}</dd>
                </div>
                <div>
                  <dt>Updated</dt>
                  <dd>{formatDate(profile.updatedAt)}</dd>
                </div>
              </dl>
            </>
          ) : (
            <div className="identity-empty identity-empty-strong">
              {isSignedIn || myProfileNotFound
                ? "Signed in, but no HeyVera profile exists yet."
                : "Sign in to begin turning this public surface into your own continuity shell."}
            </div>
          )}
        </section>

        <section className="identity-card">
          <div className="identity-card-header">
            <p className="region-summary-label">Credentials</p>
            <span className="identity-muted-pill">Lite</span>
          </div>
          <div className="identity-credential-list">
            <div className="identity-credential-row">
              <span className="identity-credential-dot identity-credential-dot-live" />
              <div>
                <strong>Account session</strong>
                <p>{isSignedIn ? viewerLabel ?? "Signed in" : "No signed-in session"}</p>
              </div>
            </div>
            <div className="identity-credential-row">
              <span className={`identity-credential-dot${profile ? " identity-credential-dot-live" : ""}`} />
              <div>
                <strong>HeyVera profile</strong>
                <p>{profile ? `@${profile.handle}` : "Profile has not been created"}</p>
              </div>
            </div>
            <div className="identity-credential-row">
              <span className={`identity-credential-dot${primaryAgent ? " identity-credential-dot-live" : ""}`} />
              <div>
                <strong>Linked agent</strong>
                <p>{primaryAgent ? `${primaryAgent.agentName} · ${normalizeState(primaryAgent.linkState)}` : "No linked agent yet"}</p>
              </div>
            </div>
            <div className="identity-credential-row">
              <span className="identity-credential-dot" />
              <div>
                <strong>Soma-native credential</strong>
                <p>Waiting on upstream credential and ceremony contracts</p>
              </div>
            </div>
          </div>
        </section>

        <section className="identity-card identity-agents-card">
          <div className="identity-card-header">
            <p className="region-summary-label">Linked Agents</p>
            <span className="identity-muted-pill">{linkedAgents.length}</span>
          </div>
          {linkedAgents.length > 0 ? (
            <div className="identity-agent-list">
              {linkedAgents.map((agent) => (
                <article key={agent.id} className="identity-agent-row">
                  <div className="identity-agent-mark" aria-hidden="true">
                    {agent.agentName.charAt(0).toUpperCase()}
                  </div>
                  <div className="identity-agent-copy">
                    <strong>{agent.agentName}</strong>
                    <span>{agent.agentSlug}</span>
                  </div>
                  <div className="identity-agent-state">
                    {agent.isPrimary ? "Primary" : normalizeState(agent.linkState)}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="identity-empty">
              Linked agents will appear here when the account has real agent authority to show.
            </div>
          )}
        </section>

        <section className="identity-card identity-ceremony-card">
          <div className="identity-card-header">
            <p className="region-summary-label">Ceremony</p>
            <span className="identity-muted-pill">Blocked honestly</span>
          </div>
          <div className="identity-ceremony-stack">
            <div>
              <strong>Current ceremony state</strong>
              <p>{profile ? "Profile continuity is visible. Recovery, delegation, and root ceremony are not live in this shell yet." : "Ceremony starts after profile creation."}</p>
            </div>
            <div>
              <strong>Next real step</strong>
              <p>Wire verified credential snapshots once Soma exposes stable frontend-safe contracts.</p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
