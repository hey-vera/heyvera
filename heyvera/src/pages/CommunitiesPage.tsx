import { useEffect, useState } from 'react';
import { SignInButton } from '@clerk/clerk-react';
import { ArrowLeft } from 'lucide-react';
import {
  bookmarkPost,
  fetchCommunities,
  fetchCommunityFeed,
  fetchMyCommunities,
  feedPostToPost,
  joinCommunity,
  leaveCommunity,
  likePost,
  repostPost,
  unbookmarkPost,
  unlikePost,
  unrepostPost,
} from '../api/social';
import type { Community, CommunityMembership, Post } from '../api/social';
import { EmptyState, ErrorState, LoadingState } from '../components/shared/AsyncStates';
import { CreateCommunityForm } from '../components/shared/CreateCommunityForm';
import { PostCard } from '../components/shared/PostCard';
import { useAuth } from '../hooks/useAuth';
import {
  canAccessGuildFeed,
  filterDiscoverGuilds,
  isPrivateGuild,
  membershipRoleLabel,
  mergeCommunityLists,
} from '../utils/guildVisibility';

const TABS = ['Your Communities', 'Discover'] as const;
type Tab = typeof TABS[number];

function formatMembers(count: number): string {
  if (count < 1000) return `${count} members`;
  return `${(count / 1000).toFixed(count < 10000 ? 1 : 0).replace(/\.0$/, '')}K members`;
}

function JoinButton({
  communityId,
  joined,
  busy,
  authEnabled,
  isSignedIn,
  onToggle,
}: {
  communityId: string;
  joined: boolean;
  busy: boolean;
  authEnabled: boolean;
  isSignedIn: boolean;
  onToggle: (id: string) => void;
}) {
  const style = {
    border: joined ? '1px solid var(--border-primary)' : undefined,
    backgroundColor: joined ? 'transparent' : 'var(--accent)',
    color: joined ? 'var(--text-primary)' : 'var(--bg-primary)',
  } as const;

  if (authEnabled && !isSignedIn) {
    return (
      <SignInButton mode="modal">
        <button
          type="button"
          className="shrink-0 rounded-full px-5 py-1.5 text-[14px] font-bold transition-all hover:opacity-90"
          style={style}
        >
          Join
        </button>
      </SignInButton>
    );
  }

  return (
    <button
      type="button"
      disabled={busy || !authEnabled}
      title={!authEnabled ? 'Sign-in is not configured' : undefined}
      onClick={() => onToggle(communityId)}
      className="shrink-0 rounded-full px-5 py-1.5 text-[14px] font-bold transition-all hover:opacity-90 disabled:opacity-50"
      style={style}
    >
      {busy ? '…' : joined ? 'Joined' : 'Join'}
    </button>
  );
}

export function CommunitiesPage() {
  const { authEnabled, isSignedIn, getToken } = useAuth();

  const [activeTab, setActiveTab] = useState<Tab>('Your Communities');
  const [communities, setCommunities] = useState<Community[]>([]);
  /** Server membership ids when /communities/mine is available; updated after join/leave. */
  const [joinedIds, setJoinedIds] = useState<Set<string>>(new Set());
  /** Role by community id from /communities/mine (owner | member). */
  const [roleById, setRoleById] = useState<Map<string, string>>(new Map());
  const [mineLoaded, setMineLoaded] = useState(false);
  const [mineAvailable, setMineAvailable] = useState(false);
  const [membershipBusyId, setMembershipBusyId] = useState<string | null>(null);
  const [membershipError, setMembershipError] = useState<string | null>(null);
  const [selectedCommunityId, setSelectedCommunityId] = useState<string | null>(null);
  const [feedPosts, setFeedPosts] = useState<Post[]>([]);
  const [feedLoading, setFeedLoading] = useState(false);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [feedReloadKey, setFeedReloadKey] = useState(0);

  const applyMineMeta = (mineList: CommunityMembership[]) => {
    const ids = new Set(mineList.map((c) => c.id));
    const roles = new Map<string, string>();
    for (const c of mineList) {
      if (c.role) roles.set(c.id, c.role);
    }
    setJoinedIds(ids);
    setRoleById(roles);
    return ids;
  };

  const reloadMemberships = async (
    token: string,
  ): Promise<{ ids: Set<string>; available: boolean }> => {
    try {
      const mine = await fetchMyCommunities(token);
      const list = mine.communities ?? [];
      const ids = applyMineMeta(list);
      setCommunities((prev) => mergeCommunityLists(prev, list));
      setMineAvailable(true);
      setMineLoaded(true);
      return { ids, available: true };
    } catch {
      setMineAvailable(false);
      setMineLoaded(true);
      return { ids: new Set(), available: false };
    }
  };

  useEffect(() => {
    let cancelled = false;

    async function loadCommunities() {
      setLoading(true);
      setError(null);
      try {
        const { communities: list } = await fetchCommunities();
        if (cancelled) return;

        if (authEnabled && isSignedIn) {
          const token = await getToken();
          if (token && !cancelled) {
            try {
              const mine = await fetchMyCommunities(token);
              const mineList = mine.communities ?? [];
              if (cancelled) return;
              applyMineMeta(mineList);
              setCommunities(mergeCommunityLists(list, mineList));
              setMineAvailable(true);
              setMineLoaded(true);
            } catch {
              if (!cancelled) {
                setCommunities(list);
                setMineAvailable(false);
                setMineLoaded(true);
                setJoinedIds(new Set());
                setRoleById(new Map());
              }
            }
          } else if (!cancelled) {
            setCommunities(list);
            setMineLoaded(true);
            setMineAvailable(false);
            setJoinedIds(new Set());
            setRoleById(new Map());
          }
        } else if (!cancelled) {
          setCommunities(list);
          setMineLoaded(true);
          setMineAvailable(false);
          setJoinedIds(new Set());
          setRoleById(new Map());
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unable to load communities');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadCommunities();
    return () => {
      cancelled = true;
    };
  }, [reloadKey, authEnabled, isSignedIn, getToken]);

  useEffect(() => {
    let cancelled = false;

    async function loadCommunityFeed() {
      if (!selectedCommunityId) {
        setFeedPosts([]);
        setFeedError(null);
        setFeedLoading(false);
        return;
      }

      const community = communities.find((c) => c.id === selectedCommunityId);
      if (!community) {
        setFeedPosts([]);
        setFeedLoading(false);
        return;
      }

      const isMember = joinedIds.has(community.id);
      if (!canAccessGuildFeed(community.visibility, isMember)) {
        if (!cancelled) {
          setFeedPosts([]);
          setFeedError('Private community — join to view the feed.');
          setFeedLoading(false);
        }
        return;
      }

      setFeedLoading(true);
      setFeedError(null);
      try {
        const token = authEnabled && isSignedIn ? await getToken() : null;
        // Backend feed path uses community id, not slug.
        const { feed } = await fetchCommunityFeed(community.id, 20, null, token);
        if (!cancelled) setFeedPosts(feed.map(feedPostToPost));
      } catch (err) {
        if (!cancelled) {
          setFeedPosts([]);
          setFeedError(err instanceof Error ? err.message : 'Unable to load community feed');
        }
      } finally {
        if (!cancelled) setFeedLoading(false);
      }
    }

    void loadCommunityFeed();
    return () => {
      cancelled = true;
    };
  }, [communities, selectedCommunityId, feedReloadKey, authEnabled, isSignedIn, getToken, joinedIds]);

  const visibleCommunities =
    activeTab === 'Your Communities'
      ? communities.filter((community) => joinedIds.has(community.id))
      : filterDiscoverGuilds(communities, joinedIds);

  const selectedCommunity =
    selectedCommunityId ? communities.find((community) => community.id === selectedCommunityId) ?? null : null;

  const toggleMembership = async (id: string) => {
    if (membershipBusyId) return;
    setMembershipError(null);

    if (!authEnabled) {
      setMembershipError('Sign-in is not configured.');
      return;
    }
    if (!isSignedIn) return;

    const token = await getToken();
    if (!token) {
      setMembershipError('Unable to get auth token. Try signing in again.');
      return;
    }

    const community = communities.find((c) => c.id === id);
    // Prefer id; fall back to slug if present (BE path segment).
    const joinKey = community?.id || community?.slug || id;
    const currentlyJoined = joinedIds.has(id);
    setMembershipBusyId(id);
    try {
      if (currentlyJoined) {
        await leaveCommunity(token, joinKey);
      } else {
        await joinCommunity(token, joinKey);
      }
      // Revalidate from server when mine is available — do not trust local Set alone.
      const refreshed = await reloadMemberships(token);
      if (!refreshed.available) {
        // Mine list unavailable: update session set from the successful mutation only.
        setJoinedIds((prev) => {
          const next = new Set(prev);
          if (currentlyJoined) next.delete(id);
          else next.add(id);
          return next;
        });
      } else if (!refreshed.ids.has(id) && !currentlyJoined) {
        // Mine returned without the new id right after join — keep optimistic id.
        setJoinedIds((prev) => new Set(prev).add(id));
      } else if (refreshed.ids.has(id) === currentlyJoined && currentlyJoined) {
        // Leave succeeded but mine still lists it — drop optimistically.
        setJoinedIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    } catch (err) {
      setMembershipError(err instanceof Error ? err.message : 'Membership update failed');
    } finally {
      setMembershipBusyId(null);
    }
  };

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
      <div
        className="sticky top-[var(--top-bar-height)] z-10 border-b backdrop-blur-md"
        style={{
          backgroundColor: 'color-mix(in srgb, var(--bg-primary) 80%, transparent)',
          borderColor: 'var(--border-primary)',
        }}
      >
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <h1 className="text-[20px] font-bold">Communities</h1>
          {authEnabled && isSignedIn && (
            <CreateCommunityForm
              getToken={getToken}
              onCommunityCreated={() => setReloadKey((key) => key + 1)}
            />
          )}
        </div>
        <div
          className="border-b px-4 py-2 text-[13px]"
          style={{
            borderColor: 'var(--border-primary)',
            backgroundColor: 'var(--bg-elevated)',
            color: 'var(--text-secondary)',
          }}
          role="status"
        >
          Communities are early access — browse, feeds, and join/leave hit the real API.
          Private guilds stay out of Discover unless you are a member; feeds require membership.
          {mineLoaded && !mineAvailable
            ? ' Membership list API is not available yet; joined state may not persist across reloads.'
            : ' Your Communities reflects server memberships (and owner role) when available.'}
        </div>
        <div className="flex">
          {TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className="flex-1 py-4 text-[15px] font-medium transition-colors hover-overlay"
              style={{ color: activeTab === tab ? 'var(--text-primary)' : 'var(--text-secondary)' }}
            >
              <span className="relative inline-block">
                {tab}
                {activeTab === tab && (
                  <span className="absolute -bottom-[17px] left-0 right-0 h-[4px] rounded-full" style={{ backgroundColor: 'var(--accent)' }} />
                )}
              </span>
            </button>
          ))}
        </div>
      </div>

      {membershipError && (
        <div
          className="border-b px-4 py-2 text-[13px]"
          style={{ borderColor: 'var(--border-primary)', color: 'var(--danger, #f4212e)' }}
          role="alert"
        >
          {membershipError}
        </div>
      )}

      {loading && <LoadingState label="Loading communities" />}
      {!loading && error && <ErrorState detail={error} onRetry={() => setReloadKey((key) => key + 1)} />}
      {!loading && !error && selectedCommunity && (
        <section>
          <div className="border-b px-4 py-3" style={{ borderColor: 'var(--border-primary)' }}>
            <button
              type="button"
              onClick={() => setSelectedCommunityId(null)}
              className="-ml-2 mb-3 flex h-9 items-center gap-2 rounded-full px-3 text-[15px] font-bold transition-colors hover-overlay"
              style={{ color: 'var(--text-primary)' }}
            >
              <ArrowLeft size={18} strokeWidth={2.25} />
              Communities
            </button>

            {(selectedCommunity as { banner_url?: string }).banner_url ? (
              <img
                src={(selectedCommunity as { banner_url?: string }).banner_url}
                alt=""
                className="h-32 w-full rounded-2xl object-cover"
                style={{ backgroundColor: 'var(--border-primary)' }}
              />
            ) : (
              <div className="h-32 rounded-2xl" style={{ backgroundColor: 'var(--border-primary)' }} />
            )}

            <div className="mt-4 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-[20px] font-bold leading-6">{selectedCommunity.name}</h2>
                  {isPrivateGuild(selectedCommunity.visibility) && (
                    <span
                      className="rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide"
                      style={{
                        backgroundColor: 'color-mix(in srgb, var(--text-secondary) 18%, transparent)',
                        color: 'var(--text-secondary)',
                      }}
                    >
                      Private
                    </span>
                  )}
                  {membershipRoleLabel(
                    roleById.get(selectedCommunity.id) ?? selectedCommunity.role,
                  ) && (
                    <span
                      className="rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide"
                      style={{
                        backgroundColor: 'color-mix(in srgb, var(--accent) 18%, transparent)',
                        color: 'var(--accent)',
                      }}
                    >
                      {membershipRoleLabel(
                        roleById.get(selectedCommunity.id) ?? selectedCommunity.role,
                      )}
                    </span>
                  )}
                </div>
                {(selectedCommunity as { member_count?: number }).member_count !== undefined && (
                  <p className="mt-0.5 text-[13px]" style={{ color: 'var(--text-secondary)' }}>
                    {formatMembers((selectedCommunity as { member_count?: number }).member_count!)}
                  </p>
                )}
                <p className="mt-2 text-[15px] leading-5">{selectedCommunity.description}</p>
              </div>

              <JoinButton
                communityId={selectedCommunity.id}
                joined={joinedIds.has(selectedCommunity.id)}
                busy={membershipBusyId === selectedCommunity.id}
                authEnabled={authEnabled}
                isSignedIn={isSignedIn}
                onToggle={(id) => void toggleMembership(id)}
              />
            </div>
          </div>

          {feedLoading && <LoadingState label="Loading community feed" />}
          {!feedLoading && feedError && (
            <ErrorState
              title="Community feed unavailable"
              detail={feedError}
              onRetry={() => setFeedReloadKey((key) => key + 1)}
            />
          )}
          {!feedLoading && !feedError && feedPosts.length === 0 && (
            <EmptyState title="No posts yet" detail="When this community has activity, it will appear here." />
          )}
          {!feedLoading && !feedError && feedPosts.map((post) => (
            <PostCard
              key={post.id}
              post={post}
              onLike={(id, liked, token) => void (liked ? likePost(token, id) : unlikePost(token, id))}
              onRepost={(id, reposted, token) => void (reposted ? repostPost : unrepostPost)(token, id)}
              onBookmark={(id, bookmarked, token) => void (bookmarked ? bookmarkPost(token, id) : unbookmarkPost(token, id))}
            />
          ))}
        </section>
      )}
      {!loading && !error && !selectedCommunity && visibleCommunities.length === 0 && (
        <EmptyState
          title={activeTab === 'Your Communities' ? 'No communities yet' : 'Nothing to discover yet'}
          detail={
            activeTab === 'Your Communities'
              ? mineAvailable
                ? 'Join communities from Discover. Memberships load from the server.'
                : 'Join communities from Discover. Server membership list is not ready yet, so joins may not show after reload.'
              : undefined
          }
        />
      )}
      {!loading && !error && !selectedCommunity && visibleCommunities.length > 0 && (
        <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-2">
          {visibleCommunities.map((community) => {
            const joined = joinedIds.has(community.id);
            return (
              <article
                key={community.id}
                role="button"
                tabIndex={0}
                onClick={() => setSelectedCommunityId(community.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setSelectedCommunityId(community.id);
                  }
                }}
                className="cursor-pointer overflow-hidden rounded-2xl border transition-colors hover:bg-white/[0.03]"
                style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-elevated)' }}
              >
                {(community as { banner_url?: string }).banner_url ? (
                  <img src={(community as { banner_url?: string }).banner_url} alt="" className="h-24 w-full object-cover" />
                ) : (
                  <div className="h-24" style={{ backgroundColor: 'var(--border-primary)' }} />
                )}

                <div className="p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-[15px] font-bold leading-tight">{community.name}</h3>
                    {isPrivateGuild(community.visibility) && (
                      <span
                        className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
                        style={{
                          backgroundColor: 'color-mix(in srgb, var(--text-secondary) 18%, transparent)',
                          color: 'var(--text-secondary)',
                        }}
                      >
                        Private
                      </span>
                    )}
                    {membershipRoleLabel(roleById.get(community.id) ?? community.role) && (
                      <span
                        className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
                        style={{
                          backgroundColor: 'color-mix(in srgb, var(--accent) 18%, transparent)',
                          color: 'var(--accent)',
                        }}
                      >
                        {membershipRoleLabel(roleById.get(community.id) ?? community.role)}
                      </span>
                    )}
                  </div>
                  {(community as { member_count?: number }).member_count !== undefined && (
                    <p className="mt-0.5 text-[13px]" style={{ color: 'var(--text-secondary)' }}>{formatMembers((community as { member_count?: number }).member_count!)}</p>
                  )}
                  <p className="mt-2 text-[13px] leading-snug">{community.description}</p>

                  <div
                    className="mt-3"
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => event.stopPropagation()}
                  >
                    <JoinButton
                      communityId={community.id}
                      joined={joined}
                      busy={membershipBusyId === community.id}
                      authEnabled={authEnabled}
                      isSignedIn={isSignedIn}
                      onToggle={(id) => void toggleMembership(id)}
                    />
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default CommunitiesPage;
