import { useState, useCallback, useEffect } from "react";
import type { ShellState } from "../../hooks/useShellState";
import { useAuthContext } from "../../hooks/useAuthContext";
import { useProfiles } from "../../hooks/useProfiles";
import { useCommunities } from "../../hooks/useCommunities";
import { useLongform } from "../../hooks/useLongform";
import { useFeaturedProfile } from "../../hooks/useFeaturedProfile";
import { useProfileStats } from "../../hooks/useProfileStats";
import { BranchRails } from "../public/BranchRails";
import { PublicFeed } from "../public/PublicFeed";
import { JoinBar } from "../public/JoinBar";
import { PublicIdentityCard } from "../shared/PublicIdentityCard";
import { CreateProfileForm } from "../shared/CreateProfileForm";
import { CreateCommunityForm } from "../shared/CreateCommunityForm";
import { CreateLongformForm } from "../shared/CreateLongformForm";
import {
  joinCommunity,
  fetchProfileWithLinkedAgents,
  fetchProfileFeed,
  followProfile,
  unfollowProfile,
  fetchFollowStatus,
  fetchCommunityFeed,
  fetchCommunityMembers,
  fetchCommunityMembershipStatus,
  leaveCommunity,
  fetchMyCommunities,
  fetchProfileFollowers,
  fetchProfileFollowing,
  fetchProfileLongform,
  updateProfile,
} from "../../api/social";
import type {
  ProfileSummary,
  Community,
  CommunityMembership,
  LongformEntry,
  LinkedAgent,
  Profile,
  FeedPost,
} from "../../api/social";

type SocialsTab = "feed" | "profiles" | "communities" | "longform" | "pulse" | "you";
type AccountViewTab = "posts" | "longform" | "communities" | "agents" | "settings" | "followers" | "following";

type VeraSocialsProps = {
  shellState: ShellState;
};

const TAB_DEFS: { key: SocialsTab; label: string; requiresReady?: boolean }[] = [
  { key: "feed", label: "Feed" },
  { key: "profiles", label: "Profiles" },
  { key: "communities", label: "Communities" },
  { key: "longform", label: "Longform" },
  { key: "pulse", label: "Pulse" },
  { key: "you", label: "You", requiresReady: true },
];

const ACCOUNT_TABS: Array<{ key: AccountViewTab; label: string }> = [
  { key: "posts", label: "Posts" },
  { key: "longform", label: "Longform" },
  { key: "communities", label: "Communities" },
  { key: "agents", label: "Agents" },
];

/** Whether the shell state allows write actions (compose, join, create). */
function canWrite(state: ShellState): boolean {
  return state === "ready";
}

// ─── Intro card variants per shell state ───────────────────────────────────

function IntroPublic() {
  return (
    <div className="region-intro-card">
      <p className="region-intro-kicker">Vera Socials</p>
      <h1 className="region-intro-title">
        A social layer for people and their agents.
      </h1>
      <p className="region-intro-copy">
        Browse profiles, communities, and longform content published on the
        Vera network. Sign in to build your own presence and link your agents.
      </p>
    </div>
  );
}

function IntroSignedOut() {
  return (
    <div className="region-intro-card">
      <p className="region-intro-kicker">Vera Socials</p>
      <h1 className="region-intro-title">
        Sign in to get started.
      </h1>
      <p className="region-intro-copy">
        Create your profile, post to the network, join communities, and link
        your agents.
      </p>
    </div>
  );
}

function IntroProfileMissing() {
  return (
    <div className="region-intro-card">
      <p className="region-intro-kicker">Vera Socials</p>
      <h1 className="region-intro-title">
        One step left — create your profile.
      </h1>
      <p className="region-intro-copy">
        You're signed in. Set up your profile below to post, join communities,
        and link your agents.
      </p>
    </div>
  );
}


// ─── Linked agents sidebar card ─────────────────────────────────────────────

function SidebarLinkedAgents({ linkedAgents }: { linkedAgents: LinkedAgent[] }) {
  return (
    <div className="vera-socials-linked-agents">
      <p className="network-sidebar-section-title">Your linked agents</p>
      {linkedAgents.length > 0 ? (
        <ul className="network-sidebar-list">
          {linkedAgents.map((a) => (
            <li key={a.id} className="network-sidebar-list-item">
              <span className="network-sidebar-list-avatar" aria-hidden="true">
                {a.agentName.charAt(0).toUpperCase()}
              </span>
              <span className="network-sidebar-list-name">{a.agentName}</span>
              <span className={`sidebar-agent-state-dot sidebar-agent-state-dot-${a.linkState}`} aria-label={a.linkState} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="network-sidebar-empty">No agents linked yet.</p>
      )}
    </div>
  );
}

// ─── Utilities ─────────────────────────────────────────────────────────────

/** Format a date string as relative time (e.g. "3 months ago"). */
function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHr / 24);
  const diffWeeks = Math.floor(diffDays / 7);
  const diffMonths = Math.floor(diffDays / 30);
  const diffYears = Math.floor(diffDays / 365);

  if (diffYears >= 1) return `${diffYears} year${diffYears > 1 ? "s" : ""} ago`;
  if (diffMonths >= 1) return `${diffMonths} month${diffMonths > 1 ? "s" : ""} ago`;
  if (diffWeeks >= 1) return `${diffWeeks} week${diffWeeks > 1 ? "s" : ""} ago`;
  if (diffDays >= 1) return `${diffDays} day${diffDays > 1 ? "s" : ""} ago`;
  if (diffHr >= 1) return `${diffHr} hour${diffHr > 1 ? "s" : ""} ago`;
  if (diffMin >= 1) return `${diffMin} minute${diffMin > 1 ? "s" : ""} ago`;
  return "just now";
}

/** Estimate reading time in minutes from a body of text. */
function estimateReadingTime(text: string): number {
  const words = text.trim().split(/\s+/).length;
  return Math.max(1, Math.ceil(words / 200));
}

// ─── Pulse tab (coming soon) ────────────────────────────────────────────────

function PulseTab() {
  return (
    <div className="vera-socials-pulse-tab">
      <div className="vera-socials-pulse-card">
        <h3 className="vera-socials-pulse-title">Pulse — Social Automation</h3>
        <p className="vera-socials-pulse-desc">
          Pulse lets your linked agents participate in Vera Socials on your behalf —
          posting, replying, and engaging communities with your approval and under
          your proof chain.
        </p>
      </div>

      {/* How it will work — step-based flow */}
      <div className="pulse-how-section">
        <h4 className="pulse-how-title">How it will work</h4>
        <div className="pulse-timeline">
          <div className="pulse-timeline-step">
            <div className="pulse-timeline-marker">
              <span className="pulse-timeline-dot" aria-hidden="true" />
              <span className="pulse-timeline-line" aria-hidden="true" />
            </div>
            <div className="pulse-timeline-content">
              <strong>You configure</strong>
              <p>Set automation rules — what your agent can post, which communities it can engage, and what needs your approval first.</p>
            </div>
          </div>
          <div className="pulse-timeline-step">
            <div className="pulse-timeline-marker">
              <span className="pulse-timeline-dot" aria-hidden="true" />
              <span className="pulse-timeline-line" aria-hidden="true" />
            </div>
            <div className="pulse-timeline-content">
              <strong>Agent acts</strong>
              <p>Your linked agent drafts posts, replies to threads, and participates in communities within the boundaries you set.</p>
            </div>
          </div>
          <div className="pulse-timeline-step">
            <div className="pulse-timeline-marker">
              <span className="pulse-timeline-dot" aria-hidden="true" />
              <span className="pulse-timeline-line" aria-hidden="true" />
            </div>
            <div className="pulse-timeline-content">
              <strong>Proof receipt</strong>
              <p>Every automated action produces a verifiable receipt on your proof chain — full auditability, no black boxes.</p>
            </div>
          </div>
        </div>
      </div>

      {/* Prerequisites */}
      <div className="pulse-prereqs">
        <h4 className="pulse-prereqs-title">Prerequisites</h4>
        <div className="pulse-prereqs-list">
          <div className="pulse-prereq-item">
            <span className="pulse-prereq-icon" aria-hidden="true" />
            <div className="pulse-prereq-text">
              <strong>Linked agent</strong>
              <p>At least one agent linked to your profile with an active link state.</p>
            </div>
          </div>
          <div className="pulse-prereq-item">
            <span className="pulse-prereq-icon" aria-hidden="true" />
            <div className="pulse-prereq-text">
              <strong>Soma session</strong>
              <p>An authenticated session with Soma contracts to authorize agent actions on-chain.</p>
            </div>
          </div>
          <div className="pulse-prereq-item">
            <span className="pulse-prereq-icon" aria-hidden="true" />
            <div className="pulse-prereq-text">
              <strong>Active proof chain</strong>
              <p>A verified continuity state so that every automated action can be anchored to your identity.</p>
            </div>
          </div>
        </div>
      </div>

      <div className="vera-socials-pulse-features">
        <div className="vera-socials-pulse-feature">
          <strong>Auto-posting</strong>
          <p>Schedule and delegate posts through your linked agents.</p>
          <span className="vera-socials-pulse-status-chip">Waiting on Vera runtime</span>
        </div>
        <div className="vera-socials-pulse-feature">
          <strong>Reply automation</strong>
          <p>Let agents reply to threads and community discussions on your behalf.</p>
          <span className="vera-socials-pulse-status-chip">Waiting on Vera runtime</span>
        </div>
        <div className="vera-socials-pulse-feature">
          <strong>Community engagement</strong>
          <p>Agent-managed community participation with membrane controls.</p>
          <span className="vera-socials-pulse-status-chip">Waiting on Soma contracts</span>
        </div>
        <div className="vera-socials-pulse-feature">
          <strong>Proof receipts</strong>
          <p>Every automated action produces a verifiable receipt on your proof chain.</p>
          <span className="vera-socials-pulse-status-chip">Waiting on Soma contracts</span>
        </div>
      </div>
    </div>
  );
}

function SidebarPulseInfo() {
  return (
    <div className="vera-socials-sidebar-pulse">
      <p className="network-sidebar-section-title">About Pulse</p>
      <p className="vera-socials-sidebar-pulse-copy">
        Pulse will let your linked agents post, reply, and participate in
        communities on your behalf — with your approval and under your proof
        chain.
      </p>
    </div>
  );
}

// ─── Profiles tab ──────────────────────────────────────────────────────────

function mapProfileToCard(p: ProfileSummary) {
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
    proofState: p.proofState,
    continuityState: p.continuityState,
  };
}

/** Inline detail panel for a selected profile. */
function ProfileDetailPanel({
  handle,
  onClose,
  shellState,
}: {
  handle: string;
  onClose: () => void;
  shellState: ShellState;
}) {
  const { isSignedIn, getToken, myProfile } = useAuthContext();
  const isSelf = myProfile?.profile.handle === handle;
  const [profile, setProfile] = useState<Profile | null>(null);
  const [agents, setAgents] = useState<LinkedAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { data: stats, loading: statsLoading } = useProfileStats(handle);

  const [followState, setFollowState] = useState<"unknown" | "following" | "not_following">("unknown");
  const [followLoading, setFollowLoading] = useState(false);

  const [recentPosts, setRecentPosts] = useState<FeedPost[]>([]);
  const [postsLoading, setPostsLoading] = useState(true);
  const [connectionView, setConnectionView] = useState<null | "followers" | "following">(null);

  // Fetch profile + linked agents
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchProfileWithLinkedAgents(handle)
      .then((result) => {
        if (!cancelled) {
          setProfile(result.profile);
          setAgents(result.linkedAgents);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [handle]);

  // Check follow status if signed in
  useEffect(() => {
    if (!isSignedIn) return;
    let cancelled = false;

    getToken().then((token) => {
      if (!token || cancelled) return;
      fetchFollowStatus(token, handle)
        .then((result) => {
          if (!cancelled) {
            setFollowState(result.following ? "following" : "not_following");
          }
        })
        .catch(() => {
          // Silently ignore — follow status is best-effort
        });
    });

    return () => {
      cancelled = true;
    };
  }, [handle, isSignedIn, getToken]);

  // Fetch recent posts for the profile
  useEffect(() => {
    let cancelled = false;
    setPostsLoading(true);

    fetchProfileFeed(handle, 5)
      .then((result) => {
        if (!cancelled) {
          setRecentPosts(result.feed);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRecentPosts([]);
        }
      })
      .finally(() => {
        if (!cancelled) setPostsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [handle]);

  async function handleToggleFollow() {
    if (!isSignedIn || followLoading) return;
    setFollowLoading(true);
    try {
      const token = await getToken();
      if (!token) return;
      if (followState === "following") {
        await unfollowProfile(token, handle);
        setFollowState("not_following");
      } else {
        await followProfile(token, handle);
        setFollowState("following");
      }
    } catch (err) {
      console.error("Follow toggle error:", err);
    } finally {
      setFollowLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="network-profile-detail" aria-busy="true">
        <div className="skeleton" style={{ height: "3em", borderRadius: "3px" }} />
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="network-profile-detail">
        <p className="network-fallback-msg">Unable to load profile details.</p>
        <button type="button" className="button button-outline" onClick={onClose}>
          Back
        </button>
      </div>
    );
  }

  const proof = proofSummary(profile.proofState, profile.continuityState);

  if (connectionView) {
    return (
      <ProfileConnectionPanel
        handle={handle}
        view={connectionView}
        onBack={() => setConnectionView(null)}
      />
    );
  }

  return (
    <div className="network-profile-detail">
      <div className="network-profile-detail-header">
        <div className="network-profile-detail-avatar" aria-hidden="true">
          {profile.displayName.charAt(0).toUpperCase()}
        </div>
        <div>
          <strong className="network-profile-detail-name">{profile.displayName}</strong>
          <span className="network-profile-detail-handle">@{profile.handle}</span>
          {isSelf && (
            <span className="profile-detail-self-badge">This is you</span>
          )}
        </div>
      </div>

      <span className={`account-proof-badge${proof.verified ? " account-proof-badge-verified" : ""}`}>
        <span className="account-proof-badge-dot" aria-hidden="true" />
        {proof.label}
      </span>

      {profile.bio && (
        <p className="network-profile-detail-bio">{profile.bio}</p>
      )}

      {/* Stats */}
      {!statsLoading && stats && (
        <div className="network-profile-detail-stats">
          <span>{stats.postCount} posts</span>
          <button
            type="button"
            className="account-header-stat-btn"
            style={{ fontSize: "inherit" }}
            onClick={() => setConnectionView("followers")}
          >
            {stats.followerCount} followers
          </button>
          <button
            type="button"
            className="account-header-stat-btn"
            style={{ fontSize: "inherit" }}
            onClick={() => setConnectionView("following")}
          >
            {stats.followingCount} following
          </button>
          <span>{stats.communityCount} communities</span>
          <span>{stats.longformCount} longform</span>
        </div>
      )}

      {/* Recent posts */}
      <div className="profile-detail-posts">
        <strong>Recent posts</strong>
        {postsLoading ? (
          <div className="profile-detail-posts-skeleton" aria-busy="true">
            {[1, 2].map((i) => (
              <div key={i} className="skeleton" style={{ height: "2.4em", borderRadius: "3px", marginTop: "6px" }} />
            ))}
          </div>
        ) : recentPosts.length === 0 ? (
          <p className="network-sidebar-empty">No posts yet.</p>
        ) : (
          <div className="profile-detail-posts-list">
            {recentPosts.map((post) => (
              <div key={post.id} className="profile-detail-post-card">
                <p className="profile-detail-post-body">{post.body}</p>
                <span className="profile-detail-post-date">
                  {formatRelativeTime(post.createdAt)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Linked agents */}
      {agents.length > 0 && (
        <div className="network-profile-detail-agents">
          <strong>Linked agents:</strong>
          <ul>
            {agents.map((a) => (
              <li key={a.id}>
                {a.agentName}{" "}
                <span className="network-profile-detail-agent-state">
                  ({a.linkState})
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Actions */}
      <div className="network-profile-detail-actions">
        {canWrite(shellState) && followState !== "unknown" && (
          <button
            type="button"
            className={`button ${followState === "following" ? "button-primary" : "button-outline"}`}
            onClick={handleToggleFollow}
            disabled={followLoading}
          >
            {followLoading
              ? "..."
              : followState === "following"
                ? "Following"
                : "Follow"}
          </button>
        )}
        <button type="button" className="button button-outline" onClick={onClose}>
          Back
        </button>
      </div>
    </div>
  );
}

/** Inline panel showing a profile's followers or following list. */
function ProfileConnectionPanel({
  handle,
  view,
  onBack,
}: {
  handle: string;
  view: "followers" | "following";
  onBack: () => void;
}) {
  const [people, setPeople] = useState<ProfileSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const fetch = view === "followers"
      ? fetchProfileFollowers(handle, 50)
      : fetchProfileFollowing(handle, 50);

    fetch
      .then((result) => {
        if (!cancelled) {
          setPeople(view === "followers"
            ? (result as Awaited<ReturnType<typeof fetchProfileFollowers>>).followers
            : (result as Awaited<ReturnType<typeof fetchProfileFollowing>>).following);
        }
      })
      .catch(() => {
        if (!cancelled) setPeople([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [handle, view]);

  return (
    <div className="network-profile-detail">
      <div className="network-profile-detail-actions" style={{ marginBottom: "12px" }}>
        <button type="button" className="button button-outline" onClick={onBack}>
          ← Back
        </button>
        <strong style={{ marginLeft: "8px" }}>
          {view === "followers" ? "Followers" : "Following"} for @{handle}
        </strong>
      </div>
      {loading ? (
        <div aria-busy="true">
          {[1, 2, 3].map((i) => (
            <div key={i} className="skeleton" style={{ height: "2.2em", borderRadius: "4px", marginBottom: "6px" }} />
          ))}
        </div>
      ) : people.length === 0 ? (
        <p className="network-sidebar-empty">
          {view === "followers" ? "No followers yet." : "Not following anyone yet."}
        </p>
      ) : (
        <ul className="network-sidebar-list" style={{ margin: 0, padding: 0 }}>
          {people.map((p) => (
            <li key={p.handle} className="network-sidebar-list-item">
              <span className="network-sidebar-list-avatar" aria-hidden="true">
                {p.displayName.charAt(0).toUpperCase()}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <span className="network-sidebar-list-name">{p.displayName}</span>
                <span className="network-sidebar-list-handle">@{p.handle}</span>
              </div>
              {p.primaryAgent && (
                <span className={`sidebar-agent-state-dot sidebar-agent-state-dot-${p.primaryAgent.linkState}`} aria-label={p.primaryAgent.linkState} />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ProfilesTab({ shellState }: { shellState: ShellState }) {
  const { data: profiles, status, loading } = useProfiles(20);
  const [filter, setFilter] = useState("");
  const [selectedHandle, setSelectedHandle] = useState<string | null>(null);

  const filtered = profiles
    ? profiles.filter((p) => {
        if (!filter.trim()) return true;
        const q = filter.toLowerCase();
        return (
          p.displayName.toLowerCase().includes(q) ||
          p.handle.toLowerCase().includes(q)
        );
      })
    : null;

  if (loading) {
    return (
      <div className="network-profiles-tab" aria-busy="true">
        <div className="network-profiles-grid">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="identity-card">
              <div
                className="identity-card-avatar skeleton"
                style={{ color: "transparent" }}
              >
                _
              </div>
              <div className="identity-card-body">
                <span
                  className="skeleton"
                  style={{
                    display: "inline-block",
                    width: "80px",
                    height: "1em",
                    borderRadius: "3px",
                  }}
                />
                <span
                  className="skeleton"
                  style={{
                    display: "inline-block",
                    width: "60px",
                    height: "0.85em",
                    borderRadius: "3px",
                    marginTop: "4px",
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Fallback state — backend unreachable
  if (status === "fallback") {
    return (
      <div className="network-profiles-tab">
        <p className="network-fallback-msg">
          Unable to reach the network — profiles unavailable.
        </p>
      </div>
    );
  }

  if (status === "live" && filtered !== null && filtered.length === 0 && !filter.trim()) {
    return (
      <div className="network-profiles-tab">
        <p className="network-empty-state">
          No profiles yet. Be the first to join the network.
        </p>
      </div>
    );
  }

  // If a profile is selected, show the detail panel
  if (selectedHandle) {
    return (
      <div className="network-profiles-tab">
        <ProfileDetailPanel
          handle={selectedHandle}
          onClose={() => setSelectedHandle(null)}
          shellState={shellState}
        />
      </div>
    );
  }

  return (
    <div className="network-profiles-tab">
      <input
        type="text"
        className="network-profiles-search"
        placeholder="Search by name or handle..."
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      {filtered && filtered.length === 0 ? (
        <p className="network-empty-state">
          No profiles matching &ldquo;{filter}&rdquo;.
        </p>
      ) : (
        <div className="network-profiles-grid">
          {(filtered ?? []).map((p) => (
            <button
              key={p.handle}
              type="button"
              className="network-profile-card-button"
              onClick={() => setSelectedHandle(p.handle)}
              aria-label={`View profile for ${p.displayName}`}
            >
              <PublicIdentityCard {...mapProfileToCard(p)} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Communities tab ───────────────────────────────────────────────────────

function CommunityCard({
  community,
  showWriteCtas,
  onSelect,
}: {
  community: Community;
  showWriteCtas: boolean;
  onSelect: (slug: string) => void;
}) {
  const { isSignedIn, getToken } = useAuthContext();
  const [joined, setJoined] = useState(false);
  const [joining, setJoining] = useState(false);

  async function handleJoin() {
    if (!isSignedIn || joining || joined) return;
    setJoining(true);
    try {
      const token = await getToken();
      if (!token) return;
      await joinCommunity(token, community.slug);
      setJoined(true);
    } catch (err) {
      console.error("Join community error:", err);
    } finally {
      setJoining(false);
    }
  }

  return (
    <article className="network-community-card">
      <button
        type="button"
        className="network-community-card-clickable"
        onClick={() => onSelect(community.slug)}
        aria-label={`View details for ${community.name}`}
      >
        <div className="network-community-header">
          <div className="network-community-avatar" aria-hidden="true">
            {community.name.charAt(0)}
          </div>
          <div className="network-community-info">
            <strong className="network-community-name">{community.name}</strong>
            <span className="network-community-slug">/{community.slug}</span>
          </div>
        </div>
        {community.description && (
          <p className="network-community-desc">{community.description}</p>
        )}
      </button>
      <div className="network-community-footer">
        <span className="network-community-creator">
          by @{community.creator.handle}
        </span>
        <span className="network-community-visibility-chip">{community.visibility}</span>
        <span className="network-community-age">{formatRelativeTime(community.createdAt)}</span>
        {showWriteCtas && isSignedIn && (
          <button
            type="button"
            className={`button ${joined ? "button-primary" : "button-outline"} network-community-join`}
            onClick={handleJoin}
            disabled={joining || joined}
          >
            {joining ? "..." : joined ? "Joined" : "Join"}
          </button>
        )}
      </div>
    </article>
  );
}

/** Inline detail panel for a selected community. */
function CommunityDetailPanel({
  community,
  showWriteCtas,
  onClose,
}: {
  community: Community;
  showWriteCtas: boolean;
  onClose: () => void;
}) {
  const { isSignedIn, getToken } = useAuthContext();
  const [isMember, setIsMember] = useState<boolean | null>(null);
  const [membershipPending, setMembershipPending] = useState(false);

  const [communityFeed, setCommunityFeed] = useState<FeedPost[]>([]);
  const [feedLoading, setFeedLoading] = useState(true);
  const [members, setMembers] = useState<ProfileSummary[]>([]);
  const [membersLoading, setMembersLoading] = useState(true);

  // Fetch community feed
  useEffect(() => {
    let cancelled = false;
    setFeedLoading(true);
    fetchCommunityFeed(community.slug, 10)
      .then((r) => { if (!cancelled) setCommunityFeed(r.feed); })
      .catch(() => { if (!cancelled) setCommunityFeed([]); })
      .finally(() => { if (!cancelled) setFeedLoading(false); });
    return () => { cancelled = true; };
  }, [community.slug]);

  // Fetch member list
  useEffect(() => {
    let cancelled = false;
    setMembersLoading(true);
    fetchCommunityMembers(community.slug, 50)
      .then((r) => { if (!cancelled) setMembers(r.members); })
      .catch(() => { if (!cancelled) setMembers([]); })
      .finally(() => { if (!cancelled) setMembersLoading(false); });
    return () => { cancelled = true; };
  }, [community.slug]);

  // Check membership status when signed in
  useEffect(() => {
    if (!isSignedIn) return;
    let cancelled = false;
    getToken().then((token) => {
      if (!token || cancelled) return;
      fetchCommunityMembershipStatus(token, community.slug)
        .then((r) => { if (!cancelled) setIsMember(r.member); })
        .catch(() => { /* best-effort */ });
    });
    return () => { cancelled = true; };
  }, [isSignedIn, getToken, community.slug]);

  async function handleJoin() {
    if (!isSignedIn || membershipPending || isMember) return;
    setMembershipPending(true);
    try {
      const token = await getToken();
      if (!token) return;
      await joinCommunity(token, community.slug);
      setIsMember(true);
      // Re-fetch member list to include the new member
      fetchCommunityMembers(community.slug, 50)
        .then((r) => setMembers(r.members))
        .catch(() => {});
    } catch (err) {
      console.error("Join community error:", err);
    } finally {
      setMembershipPending(false);
    }
  }

  async function handleLeave() {
    if (!isSignedIn || membershipPending || !isMember) return;
    setMembershipPending(true);
    try {
      const token = await getToken();
      if (!token) return;
      await leaveCommunity(token, community.slug);
      setIsMember(false);
      fetchCommunityMembers(community.slug, 50)
        .then((r) => setMembers(r.members))
        .catch(() => {});
    } catch (err) {
      console.error("Leave community error:", err);
    } finally {
      setMembershipPending(false);
    }
  }

  return (
    <div className="community-detail-panel">
      {/* Header banner */}
      <div className="community-detail-banner">
        <div className="community-detail-banner-avatar" aria-hidden="true">
          {community.name.charAt(0)}
        </div>
        <div className="community-detail-banner-info">
          <strong className="community-detail-banner-name">{community.name}</strong>
          <span className="network-community-slug">/{community.slug}</span>
          <span className="community-detail-age">
            Created {formatRelativeTime(community.createdAt)}
          </span>
        </div>
        <div className="community-detail-banner-actions">
          {showWriteCtas && isSignedIn && isMember === false && (
            <button
              type="button"
              className="button button-outline"
              onClick={handleJoin}
              disabled={membershipPending}
            >
              {membershipPending ? "..." : "Join"}
            </button>
          )}
          {showWriteCtas && isSignedIn && isMember === true && (
            <button
              type="button"
              className="button button-primary"
              onClick={handleLeave}
              disabled={membershipPending}
            >
              {membershipPending ? "..." : "Leave"}
            </button>
          )}
          <button type="button" className="button button-outline" onClick={onClose}>
            Back
          </button>
        </div>
      </div>

      {/* About / description */}
      <div className="community-detail-about">
        <h4 className="community-detail-section-title">About</h4>
        {community.description ? (
          <p className="community-detail-about-body">{community.description}</p>
        ) : (
          <p className="community-detail-about-body community-detail-about-empty">
            No description provided yet.
          </p>
        )}
        <div className="community-detail-meta-row">
          <span className="community-detail-meta-chip">{community.visibility}</span>
          <span className="community-detail-meta-chip">
            Created by @{community.creator.handle}
          </span>
          <span className="community-detail-meta-chip">
            {new Date(community.createdAt).toLocaleDateString()}
          </span>
        </div>
      </div>

      {/* Community rules */}
      <div className="community-detail-rules">
        <h4 className="community-detail-section-title">Community Rules</h4>
        <p className="community-detail-rules-note">
          Community-specific rules are set by the creator. Custom rule configuration is not yet available.
        </p>
      </div>

      {/* Members section */}
      <div className="community-detail-members-section">
        <h4 className="community-detail-section-title">
          Members{!membersLoading && members.length > 0 ? ` (${members.length})` : ""}
        </h4>
        {membersLoading ? (
          <div aria-busy="true">
            {[1, 2].map((i) => (
              <div key={i} className="skeleton" style={{ height: "2em", borderRadius: "4px", marginBottom: "6px" }} />
            ))}
          </div>
        ) : members.length === 0 ? (
          <p className="network-sidebar-empty">No members yet.</p>
        ) : (
          <ul className="network-sidebar-list" style={{ margin: 0, padding: 0 }}>
            {members.map((m) => (
              <li key={m.handle} className="network-sidebar-list-item">
                <span className="network-sidebar-list-avatar" aria-hidden="true">
                  {m.displayName.charAt(0).toUpperCase()}
                </span>
                <span className="network-sidebar-list-name">{m.displayName}</span>
                <span className="network-sidebar-list-handle">@{m.handle}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Community activity feed */}
      <div className="community-detail-activity">
        <h4 className="community-detail-section-title">Community Activity</h4>
        {feedLoading ? (
          <div className="community-detail-activity-loading" aria-busy="true">
            {[1, 2].map((i) => (
              <div key={i} className="skeleton" style={{ height: "2.4em", borderRadius: "4px", marginTop: "6px" }} />
            ))}
          </div>
        ) : communityFeed.length === 0 ? (
          <p className="network-sidebar-empty">No posts from members yet.</p>
        ) : (
          <div className="community-detail-activity-list">
            {communityFeed.map((post) => (
              <div key={post.id} className="profile-detail-post-card">
                <span className="profile-detail-post-date" style={{ marginBottom: "2px" }}>
                  @{post.author.handle}
                </span>
                <p className="profile-detail-post-body">{post.body}</p>
                <span className="profile-detail-post-date">
                  {formatRelativeTime(post.createdAt)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CommunitiesTab({ shellState }: { shellState: ShellState }) {
  const { isSignedIn, getToken, myProfile } = useAuthContext();
  const hasProfile = isSignedIn && !!myProfile;
  const showWriteCtas = canWrite(shellState);
  const [refreshKey, setRefreshKey] = useState(0);
  const { data: communities, status, loading } = useCommunities(20);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);

  const handleCreated = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  if (loading) {
    return (
      <div className="network-communities-tab" aria-busy="true">
        <div className="network-communities-grid">
          {[1, 2, 3].map((i) => (
            <article key={i} className="network-community-card">
              <div className="network-community-header">
                <div
                  className="network-community-avatar skeleton"
                  style={{ color: "transparent" }}
                >
                  _
                </div>
                <div className="network-community-info">
                  <span
                    className="skeleton"
                    style={{
                      display: "inline-block",
                      width: "120px",
                      height: "1em",
                      borderRadius: "3px",
                    }}
                  />
                </div>
              </div>
              <div
                className="skeleton"
                style={{ height: "2.4em", borderRadius: "3px" }}
              />
            </article>
          ))}
        </div>
      </div>
    );
  }

  // Fallback state — backend unreachable
  if (status === "fallback") {
    return (
      <div className="network-communities-tab">
        <p className="network-fallback-msg">
          Unable to reach the network — communities unavailable.
        </p>
      </div>
    );
  }

  const isLiveEmpty =
    status === "live" && communities !== null && communities.length === 0;

  // Show detail panel for selected community
  if (selectedSlug && communities) {
    const selected = communities.find((c) => c.slug === selectedSlug);
    if (selected) {
      return (
        <div className="network-communities-tab" key={refreshKey}>
          <CommunityDetailPanel
            community={selected}
            showWriteCtas={showWriteCtas}
            onClose={() => setSelectedSlug(null)}
          />
        </div>
      );
    }
  }

  return (
    <div className="network-communities-tab" key={refreshKey}>
      {showWriteCtas && hasProfile && (
        <div className="network-communities-create">
          <CreateCommunityForm
            getToken={getToken}
            onCommunityCreated={handleCreated}
          />
        </div>
      )}

      {isLiveEmpty ? (
        <p className="network-empty-state">
          No communities yet. Start one to gather builders around a shared idea.
        </p>
      ) : (
        <div className="network-communities-grid">
          {(communities ?? []).map((c) => (
            <CommunityCard
              key={c.id}
              community={c}
              showWriteCtas={showWriteCtas}
              onSelect={setSelectedSlug}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Longform tab ──────────────────────────────────────────────────────────

/** Map API longform entry author info for display. */
function formatLongformAuthor(entry: LongformEntry): {
  authorName: string;
  authorHandle: string;
  linkedAgent?: string;
  isLinkedWork: boolean;
} {
  const isLinkedWork = entry.authorMode === "linked_pair";
  const authorName =
    isLinkedWork && entry.linkedAgent
      ? `${entry.author.displayName} + ${entry.linkedAgent.agentName}`
      : entry.authorMode === "agent" && entry.linkedAgent
        ? entry.linkedAgent.agentName
        : entry.author.displayName;

  const authorHandle =
    entry.authorMode === "agent" && entry.linkedAgent
      ? `@${entry.author.handle}/${entry.linkedAgent.agentSlug}`
      : `@${entry.author.handle}`;

  return {
    authorName,
    authorHandle,
    linkedAgent: entry.linkedAgent?.agentName,
    isLinkedWork,
  };
}

function formatTypeToLabel(formatType: string): string {
  const map: Record<string, string> = {
    essay: "Essay",
    broadcast: "Broadcast",
    research_log: "Research Log",
    journal: "Journal",
    thread: "Thread",
    note: "Note",
  };
  return map[formatType] ?? formatType.replace(/_/g, " ");
}

function LongformTab({ shellState }: { shellState: ShellState }) {
  const { isSignedIn, getToken, myProfile } = useAuthContext();
  const hasProfile = isSignedIn && !!myProfile;
  const showWriteCtas = canWrite(shellState);
  const [refreshKey, setRefreshKey] = useState(0);
  const { data: longform, status, loading } = useLongform(20);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const handleCreated = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  if (loading) {
    return (
      <div className="network-longform-tab" aria-busy="true">
        {[1, 2, 3, 4].map((i) => (
          <article key={i} className="longform-card">
            <div className="longform-card-header">
              <span
                className="skeleton"
                style={{
                  display: "inline-block",
                  width: "60px",
                  height: "1em",
                  borderRadius: "999px",
                }}
              />
            </div>
            <div
              className="skeleton"
              style={{
                height: "1.4em",
                borderRadius: "3px",
                marginBottom: "4px",
              }}
            />
            <div
              className="skeleton"
              style={{ height: "3.2em", borderRadius: "3px" }}
            />
          </article>
        ))}
      </div>
    );
  }

  // Fallback state — backend unreachable
  if (status === "fallback") {
    return (
      <div className="network-longform-tab">
        <p className="network-fallback-msg">
          Unable to reach the network — longform entries unavailable.
        </p>
      </div>
    );
  }

  const isLiveEmpty =
    status === "live" && longform !== null && longform.length === 0;

  // If a longform entry is selected, show expanded reading view
  if (selectedId && longform) {
    const selected = longform.find((e) => e.id === selectedId);
    if (selected) {
      const author = formatLongformAuthor(selected);
      const readingMin = estimateReadingTime(selected.body);
      return (
        <div className="network-longform-tab" key={refreshKey}>
          <div className="longform-reading-view">
            <div className="longform-reading-header">
              <div className="longform-reading-header-chips">
                <span className="longform-format-label">
                  {formatTypeToLabel(selected.formatType)}
                </span>
                {selected.proofState === "verified" && (
                  <span className="longform-proof-chip">Proof verified</span>
                )}
              </div>
              <button
                type="button"
                className="button button-outline"
                onClick={() => setSelectedId(null)}
              >
                Back
              </button>
            </div>
            <h2 className="longform-reading-title">{selected.title}</h2>
            <div className="longform-reading-meta">
              <span className="longform-author-avatar" aria-hidden="true">
                {author.authorName.charAt(0)}
              </span>
              <div className="longform-reading-meta-text">
                <span className="longform-author-name">{author.authorName}</span>
                <span className="longform-author-handle">{author.authorHandle}</span>
              </div>
              {author.linkedAgent && (
                <span className={`longform-agent-context${author.isLinkedWork ? " longform-agent-linked-work" : ""}`}>
                  <span className="linked-agent-chip-dot" aria-hidden="true" />
                  {author.linkedAgent}
                </span>
              )}
              <span className="longform-reading-date">
                {new Date(selected.createdAt).toLocaleDateString(undefined, {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
              </span>
              <span className="longform-reading-time">
                {readingMin} min read
              </span>
            </div>
            {selected.summary && (
              <p className="longform-reading-summary">{selected.summary}</p>
            )}
            <div className="longform-reading-body">
              {selected.body}
            </div>
          </div>
        </div>
      );
    }
  }

  return (
    <div className="network-longform-tab" key={refreshKey}>
      {showWriteCtas && hasProfile && (
        <div className="network-longform-create">
          <CreateLongformForm
            getToken={getToken}
            onLongformCreated={handleCreated}
          />
        </div>
      )}

      {isLiveEmpty ? (
        <p className="network-empty-state">
          No longform entries yet. Publish an essay, broadcast, or journal to get
          started.
        </p>
      ) : (
        <div className="longform-shelf">
          {(longform ?? []).map((entry) => {
            const author = formatLongformAuthor(entry);
            const readMin = estimateReadingTime(entry.body);
            return (
              <article
                key={entry.id}
                className="longform-card network-longform-card-clickable"
                role="button"
                tabIndex={0}
                onClick={() => setSelectedId(entry.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelectedId(entry.id);
                  }
                }}
              >
                <div className="longform-card-header">
                  <span className="longform-format-label">
                    {formatTypeToLabel(entry.formatType)}
                  </span>
                  <span className="longform-card-reading-time">{readMin} min</span>
                </div>
                <h3 className="longform-card-title">{entry.title}</h3>
                <p className="longform-card-summary">{entry.summary}</p>
                <div className="longform-card-footer">
                  <div className="longform-card-author">
                    <span className="longform-author-avatar" aria-hidden="true">
                      {author.authorName.charAt(0)}
                    </span>
                    <span className="longform-author-name">{author.authorName}</span>
                    <span className="longform-author-handle">{author.authorHandle}</span>
                  </div>
                  {author.linkedAgent && (
                    <span className={`longform-agent-context${author.isLinkedWork ? " longform-agent-linked-work" : ""}`}>
                      <span className="linked-agent-chip-dot" aria-hidden="true" />
                      {author.linkedAgent}
                    </span>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Sidebar variants ──────────────────────────────────────────────────────

/** Profiles sidebar — shows the featured profile. */
function SidebarFeaturedProfile() {
  const { data, loading } = useFeaturedProfile();

  if (loading) {
    return (
      <div className="network-sidebar-featured" aria-busy="true">
        <p className="network-sidebar-section-title">Featured Profile</p>
        <div className="skeleton" style={{ height: "3em", borderRadius: "3px" }} />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="network-sidebar-featured">
        <p className="network-sidebar-section-title">Featured Profile</p>
        <p className="network-sidebar-empty">No featured profile available.</p>
      </div>
    );
  }

  const p = data.profile;
  return (
    <div className="network-sidebar-featured">
      <p className="network-sidebar-section-title">Featured Profile</p>
      <div className="network-sidebar-featured-card">
        <div className="network-sidebar-featured-avatar" aria-hidden="true">
          {p.displayName.charAt(0).toUpperCase()}
        </div>
        <div className="network-sidebar-featured-info">
          <strong>{p.displayName}</strong>
          <span className="network-sidebar-featured-handle">@{p.handle}</span>
          {p.bio && <p className="network-sidebar-featured-bio">{p.bio}</p>}
        </div>
      </div>
      {data.linkedAgents.length > 0 && (
        <div className="network-sidebar-featured-agents">
          {data.linkedAgents.map((a) => (
            <span key={a.id} className="network-sidebar-agent-chip">
              {a.agentName}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Communities sidebar — shows a short list of recent profiles. */
function SidebarActiveProfiles() {
  const { data: profiles, loading } = useProfiles(3);

  if (loading) {
    return (
      <div className="network-sidebar-profiles" aria-busy="true">
        <p className="network-sidebar-section-title">Active Profiles</p>
        <div className="skeleton" style={{ height: "2em", borderRadius: "3px" }} />
      </div>
    );
  }

  if (!profiles || profiles.length === 0) {
    return (
      <div className="network-sidebar-profiles">
        <p className="network-sidebar-section-title">Active Profiles</p>
        <p className="network-sidebar-empty">No profiles yet.</p>
      </div>
    );
  }

  return (
    <div className="network-sidebar-profiles">
      <p className="network-sidebar-section-title">Active Profiles</p>
      <ul className="network-sidebar-list">
        {profiles.map((p) => (
          <li key={p.handle} className="network-sidebar-list-item">
            <span className="network-sidebar-list-avatar" aria-hidden="true">
              {p.displayName.charAt(0).toUpperCase()}
            </span>
            <span className="network-sidebar-list-name">{p.displayName}</span>
            <span className="network-sidebar-list-handle">@{p.handle}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Longform sidebar — shows a short list of communities. */
function SidebarActiveCommunities() {
  const { data: communities, loading } = useCommunities(3);

  if (loading) {
    return (
      <div className="network-sidebar-communities" aria-busy="true">
        <p className="network-sidebar-section-title">Active Communities</p>
        <div className="skeleton" style={{ height: "2em", borderRadius: "3px" }} />
      </div>
    );
  }

  if (!communities || communities.length === 0) {
    return (
      <div className="network-sidebar-communities">
        <p className="network-sidebar-section-title">Active Communities</p>
        <p className="network-sidebar-empty">No communities yet.</p>
      </div>
    );
  }

  return (
    <div className="network-sidebar-communities">
      <p className="network-sidebar-section-title">Active Communities</p>
      <ul className="network-sidebar-list">
        {communities.map((c) => (
          <li key={c.id} className="network-sidebar-list-item">
            <span className="network-sidebar-list-avatar" aria-hidden="true">
              {c.name.charAt(0)}
            </span>
            <span className="network-sidebar-list-name">{c.name}</span>
            <span className="network-sidebar-list-handle">/{c.slug}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── Account / You tab ────────────────────────────────────────────────────

function AccountTab({ shellState }: { shellState: ShellState }) {
  const { myProfile, getToken, refetchMyProfile, linkedAgents } = useAuthContext();
  const [activeTab, setActiveTab] = useState<AccountViewTab>("posts");

  // ── Non-ready states ──
  if (shellState === "signed_out" || shellState === "public") {
    return (
      <div className="account-tab">
        <p className="account-empty">Sign in to view your profile.</p>
      </div>
    );
  }
  if (shellState === "loading") {
    return (
      <div className="account-tab" aria-busy="true">
        <div className="skeleton" style={{ height: "6em", borderRadius: "6px" }} />
        <div className="skeleton" style={{ height: "4em", borderRadius: "6px", marginTop: "12px" }} />
        <div className="skeleton" style={{ height: "8em", borderRadius: "6px", marginTop: "12px" }} />
      </div>
    );
  }
  if (shellState === "profile_missing") {
    return (
      <div className="account-tab">
        <p className="account-empty">
          Use the form above to create your profile and unlock the social layer.
        </p>
      </div>
    );
  }

  if (!myProfile) {
    return (
      <div className="account-tab">
        <p className="account-empty">Unable to load your profile.</p>
      </div>
    );
  }

  const profile = myProfile.profile;

  return (
    <div className="account-page">
      <AccountHeader
        profile={profile}
        onEditProfile={() => setActiveTab("settings")}
        onTabChange={setActiveTab}
      />

      <div className="account-profile-nav" role="tablist" aria-label="Profile sections">
        {ACCOUNT_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.key}
            className={`account-profile-nav-item${activeTab === tab.key ? " account-profile-nav-item-active" : ""}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
        <button
          type="button"
          className="account-profile-nav-settings"
          onClick={() => setActiveTab("settings")}
          aria-label="Profile settings"
          title="Settings"
        >
          ⚙
        </button>
      </div>

      <div className="account-tab">
        {activeTab === "posts" && <AccountPosts handle={profile.handle} />}
        {activeTab === "longform" && <AccountLongform handle={profile.handle} />}
        {activeTab === "communities" && <AccountCommunities getToken={getToken} />}
        {activeTab === "followers" && <AccountFollowers handle={profile.handle} />}
        {activeTab === "following" && <AccountFollowing handle={profile.handle} />}
        {activeTab === "agents" && <AccountLinkedAgents linkedAgents={linkedAgents} />}
        {activeTab === "settings" && (
          <>
            <AccountEditProfile profile={profile} getToken={getToken} refetchMyProfile={refetchMyProfile} />
            <AccountSettings handle={profile.handle} />
          </>
        )}
      </div>
    </div>
  );
}

// ── Profile header section ──

function proofSummary(proofState: string, continuityState: string): { label: string; verified: boolean } {
  if (proofState === "verified" && continuityState === "verified") {
    return { label: "Verified", verified: true };
  }
  if (proofState === "verified") {
    return { label: "Proof active", verified: true };
  }
  return { label: "Pending verification", verified: false };
}

function AccountHeader({
  profile,
  onEditProfile,
  onTabChange,
}: {
  profile: Profile;
  onEditProfile: () => void;
  onTabChange: (tab: AccountViewTab) => void;
}) {
  const { data: stats, loading: statsLoading } = useProfileStats(profile.handle);
  const proof = proofSummary(profile.proofState, profile.continuityState);

  return (
    <div className="account-header">
      <div className="account-header-banner" aria-hidden="true" />

      <div className="account-header-body">
        <div className="account-header-avatar" aria-hidden="true">
          {profile.displayName.charAt(0).toUpperCase()}
        </div>
        <button
          type="button"
          className="button button-outline account-header-action"
          onClick={onEditProfile}
        >
          Edit profile
        </button>
      </div>

      <div className="account-header-info">
        <div className="account-header-identity">
          <strong className="account-header-name">{profile.displayName}</strong>
          <span className="account-header-handle">@{profile.handle}</span>
        </div>

        {profile.bio && <p className="account-header-bio">{profile.bio}</p>}

        <div className="account-header-meta">
          {profile.location && <span>{profile.location}</span>}
          {profile.websiteUrl && (
            <a href={profile.websiteUrl} target="_blank" rel="noreferrer">
              {profile.websiteUrl.replace(/^https?:\/\//, "")}
            </a>
          )}
          <span>Joined {new Date(profile.createdAt).toLocaleDateString()}</span>
        </div>

        <span className={`account-proof-badge${proof.verified ? " account-proof-badge-verified" : ""}`}>
          <span className="account-proof-badge-dot" aria-hidden="true" />
          {proof.label}
        </span>
      </div>

      <div className="account-header-stats" aria-label="Profile statistics">
        {statsLoading ? (
          <>
            <span className="account-header-stat-placeholder" />
            <span className="account-header-stat-placeholder" />
          </>
        ) : stats ? (
          <>
            <button type="button" className="account-header-stat-btn" onClick={() => onTabChange("posts")}>
              <strong>{stats.postCount}</strong>{" "}posts
            </button>
            <button type="button" className="account-header-stat-btn" onClick={() => onTabChange("followers")}>
              <strong>{stats.followerCount}</strong>{" "}followers
            </button>
            <button type="button" className="account-header-stat-btn" onClick={() => onTabChange("following")}>
              <strong>{stats.followingCount}</strong>{" "}following
            </button>
            <button type="button" className="account-header-stat-btn" onClick={() => onTabChange("communities")}>
              <strong>{stats.communityCount}</strong>{" "}communities
            </button>
            <button type="button" className="account-header-stat-btn" onClick={() => onTabChange("longform")}>
              <strong>{stats.longformCount}</strong>{" "}longform
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}

// ── Linked agents section ──

function AccountLinkedAgents({ linkedAgents }: { linkedAgents: LinkedAgent[] }) {
  return (
    <div className="account-section">
      <h3 className="account-section-title">Linked Agents</h3>
      {linkedAgents.length > 0 ? (
        <div className="account-agents-list">
          {linkedAgents.map((a) => (
            <div key={a.id} className={`account-agent-row${a.isPrimary ? " account-agent-row-primary" : ""}`}>
              <div className="account-agent-row-avatar" aria-hidden="true">
                {a.agentName.charAt(0).toUpperCase()}
              </div>
              <div className="account-agent-row-body">
                <div className="account-agent-row-name-row">
                  <strong className="account-agent-row-name">{a.agentName}</strong>
                  {a.isPrimary && <span className="account-agent-primary-badge">Primary</span>}
                </div>
                <span className="account-agent-row-slug">@{a.agentSlug}</span>
              </div>
              <span className={`account-agent-state-chip account-agent-state-${a.linkState}`}>
                {a.linkState}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="account-empty">No agents linked yet.</p>
      )}
      <p className="account-blocked-note">Adding new agent links isn't available yet.</p>
    </div>
  );
}

// ── Your posts section ──

function AccountPosts({ handle }: { handle: string }) {
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchProfileFeed(handle, 10)
      .then((result) => {
        if (!cancelled) setPosts(result.feed);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [handle]);

  return (
    <div className="account-section">
      <h3 className="account-section-title">Posts</h3>
      {loading ? (
        <div className="account-posts-list" aria-busy="true">
          {[1, 2, 3].map((i) => (
            <div key={i} className="skeleton" style={{ height: "3.2em", borderRadius: "4px", marginBottom: "1px" }} />
          ))}
        </div>
      ) : error ? (
        <p className="account-empty">Unable to load posts: {error}</p>
      ) : posts.length === 0 ? (
        <p className="account-empty">No posts yet.</p>
      ) : (
        <div className="account-posts-list">
          {posts.map((post) => (
            <div key={post.id} className="account-post-item">
              <p className="account-post-body">{post.body}</p>
              <span className="account-post-meta">
                {formatRelativeTime(post.createdAt)}
                {post.replyToPostId && (
                  <span className="account-post-reply-tag">reply</span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Your longform section ──

function AccountLongform({ handle }: { handle: string }) {
  const [entries, setEntries] = useState<LongformEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchProfileLongform(handle, 50)
      .then((result) => {
        if (!cancelled) setEntries(result.longform);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [handle]);

  return (
    <div className="account-section">
      <h3 className="account-section-title">Your Longform</h3>
      {loading ? (
        <div className="account-longform-list" aria-busy="true">
          {[1, 2].map((i) => (
            <div key={i} className="skeleton" style={{ height: "3.5em", borderRadius: "4px", marginBottom: "8px" }} />
          ))}
        </div>
      ) : error ? (
        <p className="account-empty">Unable to load longform entries: {error}</p>
      ) : entries.length === 0 ? (
        <p className="account-empty">No longform entries yet.</p>
      ) : (
        <div className="account-longform-list">
          {entries.map((entry) => (
            <div key={entry.id} className="account-longform-card">
              <span className="longform-format-label">{formatTypeToLabel(entry.formatType)}</span>
              <strong className="account-longform-card-title">{entry.title}</strong>
              {entry.summary && <p className="account-longform-card-summary">{entry.summary}</p>}
              <span className="account-longform-card-date">
                {new Date(entry.createdAt).toLocaleDateString()}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Your communities section ──

function AccountCommunities({ getToken }: { getToken: () => Promise<string | null> }) {
  const [communities, setCommunities] = useState<CommunityMembership[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState<Set<string>>(new Set());

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    getToken()
      .then((token) => (token ? fetchMyCommunities(token, 50) : undefined))
      .then((result) => { if (result) setCommunities(result.communities); })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [getToken]);

  useEffect(() => { reload(); }, [reload]);

  async function handleLeave(slug: string) {
    if (leaving.has(slug)) return;
    setLeaving((prev) => new Set(prev).add(slug));
    try {
      const token = await getToken();
      if (!token) return;
      await leaveCommunity(token, slug);
      setCommunities((prev) => prev.filter((c) => c.slug !== slug));
    } catch (err) {
      console.error("Leave community error:", err);
    } finally {
      setLeaving((prev) => { const next = new Set(prev); next.delete(slug); return next; });
    }
  }

  return (
    <div className="account-section">
      <h3 className="account-section-title">Your Communities</h3>
      {loading ? (
        <div className="account-communities-list" aria-busy="true">
          {[1, 2].map((i) => (
            <div key={i} className="skeleton" style={{ height: "3em", borderRadius: "4px", marginBottom: "8px" }} />
          ))}
        </div>
      ) : error ? (
        <p className="account-empty">Unable to load communities: {error}</p>
      ) : communities.length === 0 ? (
        <p className="account-empty">You haven't joined any communities yet.</p>
      ) : (
        <div className="account-communities-list">
          {communities.map((c) => (
            <div key={c.id} className="account-community-card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <strong className="account-community-card-name">{c.name}</strong>
                  <span className="account-community-card-slug">/{c.slug}</span>
                </div>
                <button
                  type="button"
                  className="button button-outline"
                  style={{ fontSize: "0.75rem", padding: "2px 8px", marginLeft: "8px", flexShrink: 0 }}
                  onClick={() => handleLeave(c.slug)}
                  disabled={leaving.has(c.slug)}
                >
                  {leaving.has(c.slug) ? "..." : "Leave"}
                </button>
              </div>
              {c.description && <p className="account-community-card-desc">{c.description}</p>}
              <span className="account-post-meta" style={{ marginTop: "2px" }}>
                Joined {formatRelativeTime(c.joinedAt)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Followers / following sections ──

function AccountFollowers({ handle }: { handle: string }) {
  const [people, setPeople] = useState<ProfileSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchProfileFollowers(handle, 50)
      .then((r) => { if (!cancelled) setPeople(r.followers); })
      .catch(() => { if (!cancelled) setPeople([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [handle]);

  return (
    <div className="account-section">
      <h3 className="account-section-title">Followers</h3>
      {loading ? (
        <div aria-busy="true">
          {[1, 2, 3].map((i) => (
            <div key={i} className="skeleton" style={{ height: "2.4em", borderRadius: "4px", marginBottom: "6px" }} />
          ))}
        </div>
      ) : people.length === 0 ? (
        <p className="account-empty">No followers yet.</p>
      ) : (
        <ul className="network-sidebar-list" style={{ margin: 0, padding: 0 }}>
          {people.map((p) => (
            <li key={p.handle} className="network-sidebar-list-item">
              <span className="network-sidebar-list-avatar" aria-hidden="true">
                {p.displayName.charAt(0).toUpperCase()}
              </span>
              <span className="network-sidebar-list-name">{p.displayName}</span>
              <span className="network-sidebar-list-handle">@{p.handle}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AccountFollowing({ handle }: { handle: string }) {
  const [people, setPeople] = useState<ProfileSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchProfileFollowing(handle, 50)
      .then((r) => { if (!cancelled) setPeople(r.following); })
      .catch(() => { if (!cancelled) setPeople([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [handle]);

  return (
    <div className="account-section">
      <h3 className="account-section-title">Following</h3>
      {loading ? (
        <div aria-busy="true">
          {[1, 2, 3].map((i) => (
            <div key={i} className="skeleton" style={{ height: "2.4em", borderRadius: "4px", marginBottom: "6px" }} />
          ))}
        </div>
      ) : people.length === 0 ? (
        <p className="account-empty">Not following anyone yet.</p>
      ) : (
        <ul className="network-sidebar-list" style={{ margin: 0, padding: 0 }}>
          {people.map((p) => (
            <li key={p.handle} className="network-sidebar-list-item">
              <span className="network-sidebar-list-avatar" aria-hidden="true">
                {p.displayName.charAt(0).toUpperCase()}
              </span>
              <span className="network-sidebar-list-name">{p.displayName}</span>
              <span className="network-sidebar-list-handle">@{p.handle}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Edit profile form ──

function AccountEditProfile({
  profile,
  getToken,
  refetchMyProfile,
}: {
  profile: Profile;
  getToken: () => Promise<string | null>;
  refetchMyProfile: () => void;
}) {
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [bio, setBio] = useState(profile.bio);
  const [location, setLocation] = useState(profile.location ?? "");
  const [websiteUrl, setWebsiteUrl] = useState(profile.websiteUrl ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(false);

    try {
      const token = await getToken();
      if (!token) {
        setError("Not authenticated.");
        return;
      }
      await updateProfile(token, {
        displayName,
        bio,
        location: location || undefined,
        websiteUrl: websiteUrl || undefined,
      });
      setSuccess(true);
      refetchMyProfile();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="account-section">
      <h3 className="account-section-title">Edit Profile</h3>
      <form className="account-edit-form" onSubmit={handleSubmit}>
        <div className="account-edit-field">
          <label htmlFor="account-edit-displayName">Display Name</label>
          <input
            id="account-edit-displayName"
            type="text"
            className="account-edit-input"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </div>
        <div className="account-edit-field">
          <label htmlFor="account-edit-bio">Bio</label>
          <textarea
            id="account-edit-bio"
            className="account-edit-textarea"
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            rows={3}
          />
        </div>
        <div className="account-edit-field">
          <label htmlFor="account-edit-location">Location</label>
          <input
            id="account-edit-location"
            type="text"
            className="account-edit-input"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Optional"
          />
        </div>
        <div className="account-edit-field">
          <label htmlFor="account-edit-website">Website</label>
          <input
            id="account-edit-website"
            type="url"
            className="account-edit-input"
            value={websiteUrl}
            onChange={(e) => setWebsiteUrl(e.target.value)}
            placeholder="https://..."
          />
        </div>
        {error && <p className="account-edit-error">{error}</p>}
        {success && <p className="account-edit-success">Profile updated.</p>}
        <button type="submit" className="button button-primary" disabled={saving}>
          {saving ? "Saving..." : "Save Changes"}
        </button>
      </form>
    </div>
  );
}

// ── Account & settings scaffold ──

function AccountSettings({ handle }: { handle?: string }) {
  const [darkMode, setDarkMode] = useState(() => {
    if (typeof window === "undefined") return false;
    const stored = localStorage.getItem("vera-dark-mode");
    if (stored !== null) return stored === "true";
    return document.documentElement.classList.contains("dark");
  });

  const handleDarkToggle = useCallback(() => {
    setDarkMode((prev) => {
      const next = !prev;
      if (next) {
        document.documentElement.classList.add("dark");
      } else {
        document.documentElement.classList.remove("dark");
      }
      localStorage.setItem("vera-dark-mode", String(next));
      return next;
    });
  }, []);

  const futureItems = [
    { label: "Privacy controls", status: "Coming soon" },
    { label: "Notification preferences", status: "Coming soon" },
    { label: "Account deletion", status: "Coming soon" },
    { label: "Data export", status: "Coming soon" },
  ];

  return (
    <>
      {/* Your handle */}
      {handle && (
        <div className="account-section">
          <h3 className="account-section-title">Your Handle</h3>
          <div className="account-handle-display">
            <span className="account-handle-value">@{handle}</span>
          </div>
          <p className="account-handle-note">
            Handles are permanent and tied to your proof chain. They cannot be changed after creation.
          </p>
        </div>
      )}

      {/* Display preferences */}
      <div className="account-section">
        <h3 className="account-section-title">Display Preferences</h3>
        <div className="account-settings-card">
          <div className="account-settings-row">
            <span className="account-settings-label">Dark mode</span>
            <button
              type="button"
              className={`account-dark-toggle${darkMode ? " account-dark-toggle-on" : ""}`}
              onClick={handleDarkToggle}
              role="switch"
              aria-checked={darkMode}
              aria-label="Toggle dark mode"
            >
              <span className="account-dark-toggle-thumb" />
            </button>
          </div>
        </div>
      </div>

      {/* Other settings scaffold */}
      <div className="account-section">
        <h3 className="account-section-title">Account & Settings</h3>
        <div className="account-settings-card">
          {futureItems.map((item) => (
            <div key={item.label} className="account-settings-row">
              <span className="account-settings-label">{item.label}</span>
              <span className="account-settings-chip">{item.status}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// ── Sidebar for You tab ──

function SidebarAccountInfo() {
  const { myProfile } = useAuthContext();
  const handle = myProfile?.profile.handle;
  const { data: stats, loading: statsLoading } = useProfileStats(handle);

  if (!myProfile) {
    return (
      <div className="account-sidebar-info">
        <p className="network-sidebar-section-title">Your Profile</p>
        <p className="network-sidebar-empty">Not available.</p>
      </div>
    );
  }

  const profile = myProfile.profile;

  return (
    <div className="account-sidebar-info">
      <p className="network-sidebar-section-title">Your Profile</p>
      <div className="account-sidebar-identity">
        <div className="network-sidebar-list-avatar" aria-hidden="true">
          {profile.displayName.charAt(0).toUpperCase()}
        </div>
        <div className="account-sidebar-identity-text">
          <strong>{profile.displayName}</strong>
          <span className="network-sidebar-list-handle">@{profile.handle}</span>
        </div>
      </div>
      {!statsLoading && stats && (
        <div className="account-sidebar-stats">
          <span>{stats.postCount} posts</span>
          <span>{stats.followerCount} followers</span>
        </div>
      )}
      <p className="account-sidebar-hint">
        Others see your profile on the Profiles tab.
      </p>
    </div>
  );
}

// ─── Component ──────────────────────────────────────────────────────────────

export function VeraSocials({ shellState }: VeraSocialsProps) {
  const [activeTab, setActiveTab] = useState<SocialsTab>("feed");
  const { linkedAgents, getToken, refetchMyProfile, isSignedIn } = useAuthContext();

  const showLoading = shellState === "loading";
  const showReady = shellState === "ready";

  const visibleTab: SocialsTab =
    activeTab === "you" && shellState !== "ready" ? "feed" : activeTab;

  const renderIntro = () => {
    if (showLoading) return null;
    if (shellState === "public") return <IntroPublic />;
    if (shellState === "signed_out") return <IntroSignedOut />;
    if (shellState === "profile_missing") return <IntroProfileMissing />;
    if (shellState === "ready") return null;
    return null;
  };

  const renderSidebar = () => {
    switch (visibleTab) {
      case "feed":
        return <BranchRails />;
      case "profiles":
        return <SidebarFeaturedProfile />;
      case "communities":
        return <SidebarActiveCommunities />;
      case "longform":
        return <SidebarActiveProfiles />;
      case "pulse":
        return <SidebarPulseInfo />;
      case "you":
        return <SidebarAccountInfo />;
    }
  };

  return (
    <div className="region-layout vera-socials-layout">
      <section className="region-main vera-socials-main">
        <div className="vera-socials-header-shell">
          {renderIntro()}

          {shellState === "profile_missing" && (
            <div className="home-create-profile-prominent">
              <CreateProfileForm
                getToken={getToken}
                onProfileCreated={refetchMyProfile}
              />
            </div>
          )}

          {showLoading ? (
            <div className="region-subnav vera-socials-subnav" aria-busy="true">
              {TAB_DEFS.filter((t) => !t.requiresReady).map((_, i) => (
                <span
                  key={i}
                  className="region-subnav-item skeleton"
                  style={{
                    display: "inline-block",
                    width: `${50 + i * 8}px`,
                    height: "1.6em",
                    borderRadius: "999px",
                  }}
                />
              ))}
            </div>
          ) : (
            <nav className="region-subnav vera-socials-subnav" aria-label="Vera Socials sections">
              {TAB_DEFS.filter((t) => !t.requiresReady || shellState === "ready").map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={visibleTab === key}
                  className={`region-subnav-item${visibleTab === key ? " region-subnav-item-active" : ""}`}
                  onClick={() => setActiveTab(key)}
                >
                  {label}
                </button>
              ))}
            </nav>
          )}
        </div>

        <div className="vera-socials-stream">
          {showLoading ? (
            <div className="feed-column" aria-busy="true">
              {[1, 2, 3].map((i) => (
                <div key={i} className="feed-card" style={{ gap: "10px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <span
                      className="skeleton"
                      style={{ width: "30px", height: "30px", borderRadius: "50%", flexShrink: 0 }}
                    />
                    <span
                      className="skeleton"
                      style={{ width: "120px", height: "0.9em", borderRadius: "3px" }}
                    />
                  </div>
                  <div
                    className="skeleton"
                    style={{ height: "1em", width: "60%", borderRadius: "3px" }}
                  />
                  <div
                    className="skeleton"
                    style={{ height: "3.2em", borderRadius: "3px" }}
                  />
                </div>
              ))}
            </div>
          ) : (
            <>
              {visibleTab === "feed" && <PublicFeed />}
              {visibleTab === "profiles" && <ProfilesTab shellState={shellState} />}
              {visibleTab === "communities" && <CommunitiesTab shellState={shellState} />}
              {visibleTab === "longform" && <LongformTab shellState={shellState} />}
              {visibleTab === "pulse" && <PulseTab />}
              {visibleTab === "you" && <AccountTab shellState={shellState} />}
            </>
          )}

          {(shellState === "public" || shellState === "signed_out") && (
            <JoinBar />
          )}
        </div>
      </section>

      <aside className="region-side vera-socials-side">
        {showReady && isSignedIn && (
          <SidebarLinkedAgents linkedAgents={linkedAgents} />
        )}
        {renderSidebar()}
      </aside>
    </div>
  );
}
