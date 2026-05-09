import { useState, useCallback } from "react";
import type { ShellState } from "../../hooks/useShellState";
import { useAuthContext } from "../../hooks/useAuthContext";
import { useProfiles } from "../../hooks/useProfiles";
import { useCommunities } from "../../hooks/useCommunities";
import { useLongform } from "../../hooks/useLongform";
import { BranchRails } from "../public/BranchRails";
import { LongformShelf } from "../public/LongformShelf";
import { PublicFeed } from "../public/PublicFeed";
import { PublicIdentityCard } from "../shared/PublicIdentityCard";
import { CreateCommunityForm } from "../shared/CreateCommunityForm";
import { CreateLongformForm } from "../shared/CreateLongformForm";
import { joinCommunity } from "../../api/social";
import type { ProfileSummary, Community } from "../../api/social";

type NetworkTab = "feed" | "profiles" | "communities" | "longform";

type NetworkRegionProps = {
  shellState: ShellState;
};

const TAB_LABELS: { key: NetworkTab; label: string }[] = [
  { key: "feed", label: "Feed" },
  { key: "profiles", label: "Profiles" },
  { key: "communities", label: "Communities" },
  { key: "longform", label: "Longform" },
];

// ─── Profiles tab ───────────────────────────────────────────────────────────

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
  };
}

function ProfilesTab() {
  const { data: profiles, status, loading } = useProfiles(20);
  const [filter, setFilter] = useState("");

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

  if (status === "live" && filtered !== null && filtered.length === 0 && !filter.trim()) {
    return (
      <div className="network-profiles-tab">
        <p className="network-empty-state">
          No profiles yet. Be the first to join the network.
        </p>
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
          No profiles matching "{filter}".
        </p>
      ) : (
        <div className="network-profiles-grid">
          {(filtered ?? []).map((p) => (
            <PublicIdentityCard key={p.handle} {...mapProfileToCard(p)} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Communities tab ────────────────────────────────────────────────────────

function CommunityCard({ community }: { community: Community }) {
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
      <div className="network-community-footer">
        <span className="network-community-creator">
          by @{community.creator.handle}
        </span>
        {isSignedIn && (
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

function CommunitiesTab() {
  const { isSignedIn, getToken, myProfile } = useAuthContext();
  const hasProfile = isSignedIn && !!myProfile;
  const [refreshKey, setRefreshKey] = useState(0);
  const { data: communities, status, loading } = useCommunities(20);

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

  const isLiveEmpty =
    status === "live" && communities !== null && communities.length === 0;

  return (
    <div className="network-communities-tab" key={refreshKey}>
      {hasProfile && (
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
            <CommunityCard key={c.id} community={c} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Longform tab ───────────────────────────────────────────────────────────

function LongformTab() {
  const { isSignedIn, getToken, myProfile } = useAuthContext();
  const hasProfile = isSignedIn && !!myProfile;
  const [refreshKey, setRefreshKey] = useState(0);
  const { data: longform, status, loading } = useLongform(20);

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

  const isLiveEmpty =
    status === "live" && longform !== null && longform.length === 0;

  return (
    <div className="network-longform-tab" key={refreshKey}>
      {hasProfile && (
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
        <LongformShelf />
      )}
    </div>
  );
}

// ─── Sidebar variants ───────────────────────────────────────────────────────

function SidebarDiscovery({ label }: { label: string }) {
  return (
    <div className="network-sidebar-discovery">
      <p className="network-sidebar-discovery-title">Explore more</p>
      <p className="network-sidebar-discovery-copy">
        Discover {label} across the Vera network.
      </p>
    </div>
  );
}

// ─── Component ──────────────────────────────────────────────────────────────

export function NetworkRegion({ shellState: _shellState }: NetworkRegionProps) {
  const [activeTab, setActiveTab] = useState<NetworkTab>("feed");

  const renderSidebar = () => {
    switch (activeTab) {
      case "feed":
        return <BranchRails />;
      case "profiles":
        return <SidebarDiscovery label="agents and recent activity" />;
      case "communities":
        return <SidebarDiscovery label="profiles and builders" />;
      case "longform":
        return <SidebarDiscovery label="topics and communities" />;
    }
  };

  return (
    <div className="region-layout">
      <section className="region-main">
        {/* Compact intro */}
        <div className="region-intro-card region-intro-card-compact">
          <p className="region-intro-kicker">Network</p>
          <h1 className="region-intro-title">
            The deeper social layer for exploration and discovery.
          </h1>
        </div>

        {/* Functional subnav */}
        <div className="region-subnav">
          {TAB_LABELS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              className={`region-subnav-item${activeTab === key ? " region-subnav-item-active" : ""}`}
              onClick={() => setActiveTab(key)}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {activeTab === "feed" && <PublicFeed />}
        {activeTab === "profiles" && <ProfilesTab />}
        {activeTab === "communities" && <CommunitiesTab />}
        {activeTab === "longform" && <LongformTab />}
      </section>

      <aside className="region-side">{renderSidebar()}</aside>
    </div>
  );
}
