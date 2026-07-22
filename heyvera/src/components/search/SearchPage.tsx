import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useProfiles } from "../../hooks/useProfiles";
import { useCommunities } from "../../hooks/useCommunities";
import type { ShellState } from "../../hooks/useShellState";
import { PublicIdentityCard } from "../shared/PublicIdentityCard";

type SearchPageProps = {
  shellState: ShellState;
};

type SearchTab = "Profiles" | "Posts" | "Communities";

const TABS: SearchTab[] = ["Profiles", "Posts", "Communities"];

function matchesQuery(value: string, query: string) {
  return value.toLowerCase().includes(query);
}

export function SearchPage({ shellState }: SearchPageProps) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<SearchTab>("Profiles");
  const { data: profiles, loading: profilesLoading } = useProfiles(50);
  const { data: communities, loading: communitiesLoading } = useCommunities(50);

  const q = searchParams.get("q") ?? "";
  const normalizedQuery = q.trim().toLowerCase();
  const hasQuery = normalizedQuery.length > 0;

  useEffect(() => {
    setActiveTab("Profiles");
  }, [q]);

  const profileResults = hasQuery
    ? (profiles ?? []).filter(
        (profile) =>
          matchesQuery(profile.displayName, normalizedQuery) ||
          matchesQuery(profile.handle, normalizedQuery),
      )
    : [];

  const communityResults = hasQuery
    ? (communities ?? []).filter(
        (community) =>
          matchesQuery(community.name, normalizedQuery) ||
          matchesQuery(community.description, normalizedQuery),
      )
    : [];

  const tabCounts: Record<SearchTab, number> = {
    Profiles: profileResults.length,
    Posts: 0,
    Communities: communityResults.length,
  };

  function renderPrompt() {
    return (
      <div className="search-empty-state">
        <p className="search-empty-copy">Start typing to search</p>
      </div>
    );
  }

  function renderProfiles() {
    if (profilesLoading) {
      return (
        <div className="search-panel search-panel--loading" aria-busy="true">
          <p className="search-status">Loading profiles...</p>
        </div>
      );
    }

    if (profileResults.length === 0) {
      return (
        <div className="search-empty-state">
          <p className="search-empty-copy">No profiles found.</p>
        </div>
      );
    }

    return (
      <div className="search-results-list">
        {profileResults.map((profile) => (
          <div key={profile.handle} className="search-profile-card">
            <div className="search-profile-copy">
              <h2 className="search-profile-name">{profile.displayName}</h2>
              <p className="search-profile-handle">@{profile.handle}</p>
            </div>
            <a
              className="search-result-link"
              href={`/profile/${profile.handle}`}
              onClick={(event) => {
                event.preventDefault();
                navigate(`/profile/${profile.handle}`);
              }}
            >
              View profile
            </a>
          </div>
        ))}
      </div>
    );
  }

  function renderPosts() {
    return (
      <div className="search-empty-state">
        <p className="search-empty-copy">Post search coming soon</p>
      </div>
    );
  }

  function renderCommunities() {
    if (communitiesLoading) {
      return (
        <div className="search-panel search-panel--loading" aria-busy="true">
          <p className="search-status">Loading communities...</p>
        </div>
      );
    }

    if (communityResults.length === 0) {
      return (
        <div className="search-empty-state">
          <p className="search-empty-copy">No communities found.</p>
        </div>
      );
    }

    return (
      <div className="search-results-list">
        {communityResults.map((community) => {
          const memberCount = (community as { memberCount?: number }).memberCount;

          return (
            <div key={community.slug} className="search-community-card">
              <div className="search-community-copy">
                <h2 className="search-community-name">{community.name}</h2>
                <p className="search-community-members">
                  {typeof memberCount === "number"
                    ? `${memberCount} member${memberCount === 1 ? "" : "s"}`
                    : "Member count unavailable"}
                </p>
              </div>
              <a
                className="search-result-link"
                href="/communities"
                onClick={(event) => {
                  event.preventDefault();
                  // Live app has /communities only — no /community/:slug route.
                  navigate("/communities");
                }}
              >
                View communities
              </a>
            </div>
          );
        })}
      </div>
    );
  }

  function renderActiveTab() {
    if (!hasQuery) {
      return renderPrompt();
    }

    if (activeTab === "Profiles") {
      return renderProfiles();
    }

    if (activeTab === "Posts") {
      return renderPosts();
    }

    return renderCommunities();
  }

  return (
    <section
      className="search-page"
      data-shell-state={shellState}
      data-shared-card={PublicIdentityCard.name}
    >
      <header className="search-header">
        <p className="search-eyebrow">Search</p>
        <h1 className="search-title">Search results for &lsquo;{q}&rsquo;</h1>
      </header>

      <div className="search-tabs" role="tablist" aria-label="Search result tabs">
        {TABS.map((tab) => {
          const isActive = activeTab === tab;

          return (
            <button
              key={tab}
              type="button"
              role="tab"
              className={`search-tab${isActive ? " search-tab--active" : ""}`}
              aria-selected={isActive}
              onClick={() => setActiveTab(tab)}
            >
              {tab} ({tabCounts[tab]})
            </button>
          );
        })}
      </div>

      <div className="search-content">{renderActiveTab()}</div>
    </section>
  );
}
