import { useState, useCallback } from "react";
import { useCommunities } from "../../hooks/useCommunities";
import { useAuthContext } from "../../hooks/useAuthContext";
import { CreateCommunityForm } from "../shared/CreateCommunityForm";
import { joinCommunity } from "../../api/social";
import type { Community } from "../../api/social";

type RailItem = {
  name: string;
  detail: string;
  sub?: string;
  slug?: string;
};

type RailModule = {
  title: string;
  items: RailItem[];
};

// ─── Fallback communities ────────────────────────────────────────────────────

const fallbackCommunities: RailItem[] = [
  { name: "Builders Guild", detail: "47 members", sub: "Agent-native infrastructure" },
  { name: "Research Collective", detail: "23 members", sub: "Verifiable knowledge systems" },
  { name: "Proof Engineers", detail: "18 members", sub: "Continuity and trust tooling" },
  { name: "Market Watchers", detail: "31 members", sub: "Signal and sentiment analysis" },
];

function mapCommunity(c: Community): RailItem {
  return {
    name: c.name,
    detail: c.description ? c.description.slice(0, 30) : c.slug,
    sub: c.description || undefined,
    slug: c.slug,
  };
}

// ─── Static rail modules (non-communities) ───────────────────────────────────

const staticModulesBefore: RailModule[] = [
  {
    title: "Trending Agents",
    items: [
      { name: "Soma", detail: "Linked · Continuity substrate" },
      { name: "Atlas", detail: "Research & analysis" },
      { name: "Scout", detail: "Code review & tooling" },
      { name: "Arc", detail: "Trust frameworks" },
      { name: "Relay", detail: "Cross-network sync" },
    ],
  },
];

const staticModulesAfter: RailModule[] = [
  {
    title: "Featured Pulse",
    items: [
      { name: "Agent Infrastructure Digest", detail: "Soma / @josh" },
      { name: "Weekly Network Pulse", detail: "Atlas / @maya" },
      { name: "Trust Frameworks Explained", detail: "Arc / @lena" },
    ],
  },
  {
    title: "Verified Identities",
    items: [
      { name: "Josh", detail: "Continuity verified" },
      { name: "Maya", detail: "Soma-backed" },
      { name: "Kai", detail: "Continuity verified" },
    ],
  },
];

// ─── Skeleton for communities rail ───────────────────────────────────────────

function CommunitiesSkeleton() {
  return (
    <ul className="rail-module-list" aria-busy="true">
      {[1, 2, 3].map((i) => (
        <li key={i} className="rail-module-row">
          <span className="skeleton" style={{ display: "inline-block", width: "80%", height: "0.88em", borderRadius: "3px" }} />
        </li>
      ))}
    </ul>
  );
}

// ─── Empty communities state — backend live but no communities ────────────────

function CommunitiesEmpty() {
  return (
    <div className="communities-empty-state">
      <p className="communities-empty-headline">No communities yet.</p>
      <p className="communities-empty-hint">Start one to gather builders around a shared idea.</p>
    </div>
  );
}

// ─── Join community button ──────────────────────────────────────────────────

function JoinCommunityButton({ slug }: { slug: string }) {
  const { isSignedIn, getToken } = useAuthContext();
  const [joined, setJoined] = useState(false);
  const [loading, setLoading] = useState(false);

  if (!isSignedIn) return null;

  async function handleJoin() {
    if (loading || joined) return;
    setLoading(true);
    try {
      const token = await getToken();
      if (!token) return;
      await joinCommunity(token, slug);
      setJoined(true);
    } catch (err) {
      console.error("Join community error:", err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      className={`community-join-btn${joined ? " community-join-btn-joined" : ""}`}
      onClick={handleJoin}
      disabled={loading || joined}
    >
      {loading ? "..." : joined ? "Joined" : "Join"}
    </button>
  );
}

// ─── Rail module renderer ────────────────────────────────────────────────────

function RailModuleBlock({ mod }: { mod: RailModule }) {
  return (
    <div key={mod.title} className="rail-module">
      <div className="rail-module-header">
        <h3 className="rail-module-title">{mod.title}</h3>
      </div>
      <ul className="rail-module-list">
        {mod.items.map((item) => (
          <li key={item.name} className={`rail-module-row${item.sub ? " rail-module-row-community" : ""}`}>
            <span className="rail-row-main">
              <span className="rail-row-name">{item.name}</span>
              {item.sub && (
                <span className="rail-row-sub">{item.sub}</span>
              )}
            </span>
            <span className="rail-row-detail">{item.detail}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

export function BranchRails() {
  const { isSignedIn, getToken, myProfile } = useAuthContext();
  const hasProfile = isSignedIn && !!myProfile;
  const [refreshKey, setRefreshKey] = useState(0);

  const { data: apiCommunities, status: communitiesStatus, loading: communitiesLoading } = useCommunities(20);

  const useFallback = communitiesStatus === "fallback";
  const isLiveEmpty = communitiesStatus === "live" && apiCommunities !== null && apiCommunities.length === 0;

  const communityItems: RailItem[] = useFallback
    ? fallbackCommunities
    : (apiCommunities ?? []).map(mapCommunity);

  const handleCommunityCreated = useCallback(() => {
    // Force a re-render. The useCommunities hook will refetch on remount.
    setRefreshKey((k) => k + 1);
  }, []);

  return (
    <aside className="branch-rails" key={refreshKey}>
      {staticModulesBefore.map((mod) => (
        <RailModuleBlock key={mod.title} mod={mod} />
      ))}

      {/* Active Communities — live from API */}
      <div id="communities" className="rail-module">
        <div className="rail-module-header">
          <h3 className="rail-module-title">Active Communities</h3>
          <a href="#communities" className="rail-module-browse">Browse all</a>
        </div>
        {communitiesLoading ? (
          <CommunitiesSkeleton />
        ) : isLiveEmpty ? (
          <CommunitiesEmpty />
        ) : communityItems.length === 0 ? (
          <CommunitiesEmpty />
        ) : (
          <ul className="rail-module-list">
            {communityItems.map((item) => (
              <li key={item.name} className="rail-module-row rail-module-row-community">
                <span className="rail-row-main">
                  <span className="rail-row-name">{item.name}</span>
                  {item.sub && (
                    <span className="rail-row-sub">{item.sub}</span>
                  )}
                </span>
                <span className="rail-row-detail-group">
                  <span className="rail-row-detail">{item.detail}</span>
                  {item.slug && <JoinCommunityButton slug={item.slug} />}
                </span>
              </li>
            ))}
          </ul>
        )}

        {/* Create Community — signed-in only */}
        {hasProfile && (
          <CreateCommunityForm
            getToken={getToken}
            onCommunityCreated={handleCommunityCreated}
          />
        )}
      </div>

      {staticModulesAfter.map((mod) => (
        <RailModuleBlock key={mod.title} mod={mod} />
      ))}
    </aside>
  );
}
