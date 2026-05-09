import { useState, useEffect } from "react";
import { PublicIdentityCard } from "../shared/PublicIdentityCard";
import { CreateProfileForm } from "../shared/CreateProfileForm";
import { useFeaturedProfile } from "../../hooks/useFeaturedProfile";
import { useProfileStats } from "../../hooks/useProfileStats";
import { useProfiles } from "../../hooks/useProfiles";
import { useAuthContext } from "../../hooks/useAuthContext";
import { followProfile, unfollowProfile, fetchFollowStatus } from "../../api/social";

// ─── Hardcoded fallback data ─────────────────────────────────────────────────

const FALLBACK_SECONDARY_PROFILES = [
  {
    displayName: "Sample Member",
    handle: "@member-1",
    roleLine: "Preview identity — real profiles appear when backend is live",
    agentName: "Agent-A",
    agentState: "Linked" as const,
    proofLabel: "Preview",
    statusLine: "This is preview data",
  },
  {
    displayName: "Sample Builder",
    handle: "@builder-1",
    roleLine: "Preview identity — real profiles appear when backend is live",
    agentName: "Agent-B",
    agentState: "Verified" as const,
    proofLabel: "Preview",
    statusLine: "This is preview data",
  },
  {
    displayName: "Sample Creator",
    handle: "@creator-1",
    roleLine: "Preview identity — real profiles appear when backend is live",
    agentName: "Agent-C",
    agentState: "Active" as const,
    proofLabel: "Preview",
    statusLine: "This is preview data",
  },
];

const FALLBACK_PROFILE = {
  displayName: "Vera Member",
  handle: "@vera",
  bio: "Welcome to Vera Socials — the sovereign social network for people and their linked agents.",
  proofLabel: "Preview",
};

const FALLBACK_AGENT = {
  name: "Soma",
  status: "Active · Linked agent",
  type: "Continuity Agent",
};

const FALLBACK_STATS = {
  postCount: 0,
  linkedAgentCount: 1,
  followerCount: 0,
};

// ─── Skeleton helpers ────────────────────────────────────────────────────────

function ProfileSkeleton() {
  return (
    <div className="featured-profile" aria-busy="true" aria-label="Loading profile">
      <div className="featured-profile-header">
        <div className="featured-profile-avatar skeleton" style={{ color: "transparent" }}>_</div>
        <div className="featured-profile-identity">
          <div className="featured-profile-name-row">
            <span className="skeleton" style={{ display: "inline-block", width: "80px", height: "1.2em", borderRadius: "3px" }} />
            <span className="skeleton" style={{ display: "inline-block", width: "60px", height: "1em", borderRadius: "3px" }} />
          </div>
          <p className="skeleton" style={{ height: "1em", width: "70%", borderRadius: "3px", marginTop: "6px" }} />
        </div>
      </div>
      <div className="featured-profile-agent skeleton" style={{ height: "60px", border: "none" }} />
      <div className="featured-profile-stats">
        <span className="skeleton" style={{ display: "inline-block", width: "60px", height: "0.9em", borderRadius: "3px" }} />
        <span className="skeleton" style={{ display: "inline-block", width: "80px", height: "0.9em", borderRadius: "3px" }} />
        <span className="skeleton" style={{ display: "inline-block", width: "90px", height: "0.9em", borderRadius: "3px" }} />
      </div>
    </div>
  );
}

// ─── Empty state — backend live but no profile found ─────────────────────────

function ProfileEmpty() {
  return (
    <div className="profile-empty-state">
      <div className="profile-empty-avatar" aria-hidden="true">V</div>
      <div className="profile-empty-copy">
        <strong className="profile-empty-title">This network is just getting started</strong>
        <p className="profile-empty-desc">
          No profiles yet. Be the first to join Vera and stake your identity on the open network.
        </p>
        <button type="button" className="button button-outline profile-empty-cta" disabled>
          Create Profile
        </button>
        <p className="profile-empty-dev-hint">
          Developer? Run <code>npm run seed:social</code> to populate sample data.
        </p>
      </div>
    </div>
  );
}

// ─── Live empty state for secondary profiles ─────────────────────────────────

function SecondaryProfilesEmpty() {
  return (
    <div className="profile-grid-empty">
      <p className="profile-grid-empty-message">The network is growing — more identities coming soon</p>
      <div className="profile-ghost-cards" aria-hidden="true">
        {[1, 2, 3].map((i) => (
          <div key={i} className="profile-ghost-card">
            <div className="profile-ghost-avatar" />
            <div className="profile-ghost-lines">
              <div className="profile-ghost-line profile-ghost-line-name" />
              <div className="profile-ghost-line profile-ghost-line-handle" />
              <div className="profile-ghost-line profile-ghost-line-role" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Map a ProfileSummary to PublicIdentityCard props ────────────────────────

function mapProfileToCard(p: {
  displayName: string;
  handle: string;
  bio: string;
  proofState: string;
  continuityState: string;
  primaryAgent: { agentName: string; agentSlug: string; linkState: string } | null;
}) {
  const agentState =
    p.primaryAgent?.linkState === "verified"
      ? ("Verified" as const)
      : p.primaryAgent?.linkState === "active"
        ? ("Active" as const)
        : ("Linked" as const);

  const proofLabel =
    p.continuityState === "verified" || p.proofState === "verified"
      ? "Continuity verified"
      : "Soma-backed";

  return {
    displayName: p.displayName,
    handle: `@${p.handle}`,
    roleLine: p.bio,
    agentName: p.primaryAgent?.agentName ?? "No agent",
    agentState,
    proofLabel,
    statusLine: "",
  };
}

// ─── Follow button component ────────────────────────────────────────────────

function FollowButton({ handle }: { handle: string }) {
  const { isSignedIn, getToken, myProfile } = useAuthContext();
  const [following, setFollowing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);

  // Don't show follow for your own profile
  const isOwnProfile = myProfile?.profile.handle === handle;

  // Check follow status on mount when signed in
  useEffect(() => {
    if (!isSignedIn || isOwnProfile) return;
    let cancelled = false;
    setChecking(true);
    getToken()
      .then((token) => {
        if (!token || cancelled) return;
        return fetchFollowStatus(token, handle);
      })
      .then((result) => {
        if (!cancelled && result) {
          setFollowing(result.following);
        }
      })
      .catch(() => {
        // If status check fails (e.g., user has no profile yet), default to false
        if (!cancelled) setFollowing(false);
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => { cancelled = true; };
  }, [isSignedIn, isOwnProfile, handle, getToken]);

  if (isOwnProfile) return null;

  async function handleToggle() {
    if (!isSignedIn || loading) return;
    setLoading(true);
    try {
      const token = await getToken();
      if (!token) return;
      if (following) {
        await unfollowProfile(token, handle);
        setFollowing(false);
      } else {
        await followProfile(token, handle);
        setFollowing(true);
      }
    } catch (err) {
      console.error("Follow toggle error:", err);
    } finally {
      setLoading(false);
    }
  }

  if (!isSignedIn) {
    return (
      <button type="button" className="button button-outline featured-profile-action" disabled>
        Follow
      </button>
    );
  }

  return (
    <button
      type="button"
      className={`button ${following ? "button-primary" : "button-outline"} featured-profile-action`}
      onClick={handleToggle}
      disabled={loading || checking}
    >
      {loading || checking ? "..." : following ? "Following" : "Follow"}
    </button>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ProfileSurface() {
  const {
    isSignedIn,
    getToken,
    myProfile,
    myProfileNotFound,
    refetchMyProfile,
    refreshCounter,
  } = useAuthContext();

  // If signed in and has a profile, show their own profile as featured
  const showOwnProfile = isSignedIn && myProfile?.profile;
  const featuredHandle = showOwnProfile
    ? myProfile.profile.handle
    : undefined;

  const { data, status, loading } = useFeaturedProfile(
    showOwnProfile ? featuredHandle : undefined,
  );

  // When signed in + own profile, use myProfile data directly
  const effectiveProfile = showOwnProfile ? myProfile.profile : data?.profile;
  const effectiveLinkedAgents = showOwnProfile
    ? myProfile.linkedAgents
    : data?.linkedAgents ?? [];

  const statsHandle = effectiveProfile?.handle;
  const { data: stats } = useProfileStats(statsHandle, refreshCounter);

  const { data: profilesList, status: profilesStatus } = useProfiles(4);

  const isFallback = status === "fallback" && !showOwnProfile;
  const isLiveEmpty = status === "live" && !effectiveProfile && !showOwnProfile;

  const profile = effectiveProfile;
  const primaryAgent =
    effectiveLinkedAgents.find((a) => a.isPrimary) ?? effectiveLinkedAgents[0];

  const displayName = profile?.displayName ?? FALLBACK_PROFILE.displayName;
  const handle = profile ? `@${profile.handle}` : FALLBACK_PROFILE.handle;
  const bio = profile?.bio ?? FALLBACK_PROFILE.bio;
  const proofLabel =
    profile?.continuityState === "verified"
      ? "Continuity verified"
      : profile?.proofState === "verified"
        ? "Proof verified"
        : FALLBACK_PROFILE.proofLabel;

  const agentName = primaryAgent?.agentName ?? FALLBACK_AGENT.name;
  const agentStatus = primaryAgent
    ? `${primaryAgent.linkState} · Linked agent`
    : FALLBACK_AGENT.status;
  const agentSubtype = primaryAgent?.agentType
    ? primaryAgent.agentType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) + " Agent"
    : FALLBACK_AGENT.type;

  // Stats
  const postCount = stats?.postCount ?? FALLBACK_STATS.postCount;
  const linkedAgentCount = stats?.linkedAgentCount ?? (effectiveLinkedAgents.length ?? FALLBACK_STATS.linkedAgentCount);
  const followerCount = stats?.followerCount ?? FALLBACK_STATS.followerCount;

  // Secondary profiles
  const secondaryProfiles = (() => {
    if (!profilesList) return null;
    const others = profilesList.filter((p) => p.handle !== statsHandle);
    return others;
  })();

  const renderSecondarySection = () => {
    if (profilesStatus === "fallback" || !profilesList) {
      return (
        <div className="profile-grid">
          {FALLBACK_SECONDARY_PROFILES.map((p) => (
            <PublicIdentityCard key={p.handle} {...p} />
          ))}
        </div>
      );
    }
    if (profilesStatus === "live" && secondaryProfiles !== null && secondaryProfiles.length === 0) {
      return <SecondaryProfilesEmpty />;
    }
    if (secondaryProfiles && secondaryProfiles.length > 0) {
      return (
        <div className="profile-grid">
          {secondaryProfiles.map((p) => (
            <PublicIdentityCard key={p.handle} {...mapProfileToCard(p)} />
          ))}
        </div>
      );
    }
    return null;
  };

  // Signed in but no profile — show create profile CTA
  const showCreateProfileCta = isSignedIn && myProfileNotFound;

  return (
    <div className="profile-surface">
      {/* Create Profile CTA for signed-in users without a profile */}
      {showCreateProfileCta && (
        <CreateProfileForm
          getToken={getToken}
          onProfileCreated={refetchMyProfile}
        />
      )}

      {/* Featured profile */}
      {loading && !showOwnProfile ? (
        <ProfileSkeleton />
      ) : isLiveEmpty && !showCreateProfileCta ? (
        <ProfileEmpty />
      ) : profile ? (
        <div className="featured-profile">
          <div className="featured-profile-header">
            <div className="featured-profile-avatar" aria-hidden="true">
              {displayName.charAt(0)}
            </div>
            <div className="featured-profile-identity">
              <div className="featured-profile-name-row">
                <strong className="featured-profile-name">{displayName}</strong>
                <span className="featured-profile-handle">{handle}</span>
                <span className="featured-profile-proof-chip">
                  <span className="proof-chip-icon" aria-hidden="true" />
                  {proofLabel}
                </span>
              </div>
              <p className="featured-profile-bio">{bio}</p>
            </div>
            <FollowButton handle={profile.handle} />
          </div>

          {/* Linked agent — prominent */}
          <div className="featured-profile-agent">
            <div className="featured-profile-agent-header">
              <span className="featured-profile-agent-dot" aria-hidden="true" />
              <strong className="featured-profile-agent-name">{agentName}</strong>
              <span className="featured-profile-agent-status">{agentStatus}</span>
            </div>
            {agentSubtype && (
              <p className="featured-profile-agent-desc">{agentSubtype}</p>
            )}
          </div>

          {/* Link Agent — deferred, requires Soma agent registration */}
          {/* TODO: Enable when Soma session detection is available on the frontend */}
          {isSignedIn && showOwnProfile && (
            <>
              <button
                type="button"
                className="button button-outline featured-profile-link-agent"
                disabled
                title="Requires Soma agent registration — configure your Soma heart first"
              >
                Link Agent
              </button>
              <p className="link-agent-hint">
                Soma agent registration is required to link an agent to your profile.
              </p>
            </>
          )}

          {/* Stats */}
          <div className="featured-profile-stats">
            <span className="featured-profile-stat">
              <strong>{postCount}</strong> posts
            </span>
            <span className="featured-profile-stat-sep" aria-hidden="true">·</span>
            <span className="featured-profile-stat">
              <strong>{linkedAgentCount}</strong> linked {linkedAgentCount === 1 ? "agent" : "agents"}
            </span>
            <span className="featured-profile-stat-sep" aria-hidden="true">·</span>
            <span className="featured-profile-stat">
              <strong>{followerCount}</strong> connections
            </span>
          </div>
        </div>
      ) : null}

      {/* Secondary profiles */}
      {!isLiveEmpty && !showCreateProfileCta && renderSecondarySection()}

      {/* Preview mode indicator */}
      {isFallback && <PreviewModeBanner />}
    </div>
  );
}

// ─── Preview mode banner (exported for use in other sections) ────────────────

export function PreviewModeBanner() {
  return (
    <div className="preview-mode-banner" role="status" aria-label="Preview mode — backend not connected">
      <span className="preview-mode-dot" aria-hidden="true" />
      Preview mode — connect backend for live data
    </div>
  );
}
