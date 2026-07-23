import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { SignInButton } from '@clerk/clerk-react';
import { ArrowLeft } from 'lucide-react';
import {
  bookmarkPost,
  createCommunityInvite,
  fetchCommunities,
  fetchCommunityFeed,
  fetchCommunityInvites,
  fetchCommunityMembers,
  fetchMyCommunities,
  feedPostToPost,
  joinCommunity,
  leaveCommunity,
  likePost,
  repostPost,
  revokeCommunityInvite,
  unbookmarkPost,
  unlikePost,
  unrepostPost,
} from '../api/social';
import type { Community, CommunityInvite, CommunityMember, CommunityMembership, Post } from '../api/social';
import { EmptyState, ErrorState, LoadingState } from '../components/shared/AsyncStates';
import { CreateCommunityForm } from '../components/shared/CreateCommunityForm';
import { PostCard } from '../components/shared/PostCard';
import { useAuth } from '../hooks/useAuth';
import {
  canAccessGuildFeed,
  filterDiscoverGuilds,
  guildInviteShareUrl,
  isPrivateGuild,
  membershipRoleLabel,
  mergeCommunityLists,
  privateGuildJoinCtaCopy,
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
  privateGuild,
  onToggle,
}: {
  communityId: string;
  joined: boolean;
  busy: boolean;
  authEnabled: boolean;
  isSignedIn: boolean;
  privateGuild: boolean;
  onToggle: (id: string) => void;
}) {
  // Private non-members: no open join CTA (invite redeem only).
  if (privateGuild && !joined) {
    return (
      <span
        className="shrink-0 rounded-full border px-4 py-1.5 text-[13px] font-medium"
        style={{ borderColor: 'var(--border-secondary)', color: 'var(--text-secondary)' }}
        title="Private community — redeem an invite link to join"
      >
        Invite only
      </span>
    );
  }

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
          className="shrink-0 rounded-full px-5 py-1.5 text-[14px] font-bold transition-all hover:opacity-90 focus-visible:outline-none focus-ring"
          style={style}
        >
          Join
        </button>
      </SignInButton>
    );
  }

  // Joined → Leave (real leave API). No Kick/Ban tools.
  return (
    <button
      type="button"
      disabled={busy || !authEnabled}
      title={!authEnabled ? 'Sign-in is not configured' : joined ? 'Leave via the real leave API' : 'Join via the real join API'}
      onClick={() => onToggle(communityId)}
      className="shrink-0 rounded-full px-5 py-1.5 text-[14px] font-bold transition-all hover:opacity-90 disabled:opacity-50 focus-visible:outline-none focus-ring"
      style={style}
      aria-busy={busy || undefined}
      aria-pressed={joined || undefined}
    >
      {busy ? '…' : joined ? 'Leave' : 'Join'}
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

  // Members list (detail)
  const [members, setMembers] = useState<CommunityMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersError, setMembersError] = useState<string | null>(null);

  // Owner invites (detail)
  const [invites, setInvites] = useState<CommunityInvite[]>([]);
  const [invitesLoading, setInvitesLoading] = useState(false);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [lastCreatedToken, setLastCreatedToken] = useState<string | null>(null);
  const [copyNotice, setCopyNotice] = useState<string | null>(null);

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
          setFeedError('Private community — join via invite to view the feed.');
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

  // Members list for detail (private ACL enforced server-side).
  useEffect(() => {
    let cancelled = false;

    async function loadMembers() {
      if (!selectedCommunityId) {
        setMembers([]);
        setMembersError(null);
        setMembersLoading(false);
        return;
      }

      const community = communities.find((c) => c.id === selectedCommunityId);
      if (!community) return;

      const isMember = joinedIds.has(community.id);
      if (isPrivateGuild(community.visibility) && !isMember) {
        setMembers([]);
        setMembersError(null);
        setMembersLoading(false);
        return;
      }

      setMembersLoading(true);
      setMembersError(null);
      try {
        const token = authEnabled && isSignedIn ? await getToken() : null;
        const result = await fetchCommunityMembers(community.id, 50, token);
        if (!cancelled) setMembers(result.members ?? []);
      } catch (err) {
        if (!cancelled) {
          setMembers([]);
          setMembersError(err instanceof Error ? err.message : 'Unable to load members');
        }
      } finally {
        if (!cancelled) setMembersLoading(false);
      }
    }

    void loadMembers();
    return () => {
      cancelled = true;
    };
  }, [selectedCommunityId, communities, joinedIds, authEnabled, isSignedIn, getToken, membershipBusyId]);

  // Owner invites for detail.
  useEffect(() => {
    let cancelled = false;

    async function loadInvites() {
      setLastCreatedToken(null);
      setCopyNotice(null);
      if (!selectedCommunityId) {
        setInvites([]);
        setInvitesLoading(false);
        setInviteError(null);
        return;
      }
      const community = communities.find((c) => c.id === selectedCommunityId);
      if (!community) return;
      const role = roleById.get(community.id) ?? community.role;
      if (role !== 'owner' || !authEnabled || !isSignedIn) {
        setInvites([]);
        setInvitesLoading(false);
        return;
      }

      setInvitesLoading(true);
      setInviteError(null);
      try {
        const token = await getToken();
        if (!token) {
          if (!cancelled) setInvites([]);
          return;
        }
        const result = await fetchCommunityInvites(token, community.id);
        if (!cancelled) setInvites(result.invites ?? []);
      } catch (err) {
        if (!cancelled) {
          setInvites([]);
          setInviteError(err instanceof Error ? err.message : 'Unable to load invites');
        }
      } finally {
        if (!cancelled) setInvitesLoading(false);
      }
    }

    void loadInvites();
    return () => {
      cancelled = true;
    };
  }, [selectedCommunityId, communities, roleById, authEnabled, isSignedIn, getToken]);

  const visibleCommunities =
    activeTab === 'Your Communities'
      ? communities.filter((community) => joinedIds.has(community.id))
      : filterDiscoverGuilds(communities, joinedIds);

  const selectedCommunity =
    selectedCommunityId ? communities.find((community) => community.id === selectedCommunityId) ?? null : null;

  const selectedRole =
    selectedCommunity
      ? roleById.get(selectedCommunity.id) ?? selectedCommunity.role
      : undefined;
  const isOwner = selectedRole?.toLowerCase() === 'owner';

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
    if (community && isPrivateGuild(community.visibility) && !joinedIds.has(id)) {
      setMembershipError('Private community — redeem an invite link to join.');
      return;
    }

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

  const handleCreateInvite = async () => {
    if (!selectedCommunity || inviteBusy) return;
    if (!authEnabled || !isSignedIn) return;
    setInviteError(null);
    setCopyNotice(null);
    setInviteBusy(true);
    try {
      const token = await getToken();
      if (!token) {
        setInviteError('Unable to get auth token.');
        return;
      }
      const result = await createCommunityInvite(token, selectedCommunity.id, {
        maxUses: 25,
        expiresInHours: 24 * 14,
      });
      const created = result.invite;
      if (created?.token) {
        setLastCreatedToken(created.token);
      }
      // Refresh list (without plaintext tokens).
      const listed = await fetchCommunityInvites(token, selectedCommunity.id);
      setInvites(listed.invites ?? []);
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : 'Create invite failed');
    } finally {
      setInviteBusy(false);
    }
  };

  const handleRevokeInvite = async (inviteId: string) => {
    if (!selectedCommunity || inviteBusy) return;
    setInviteError(null);
    setInviteBusy(true);
    try {
      const token = await getToken();
      if (!token) {
        setInviteError('Unable to get auth token.');
        return;
      }
      await revokeCommunityInvite(token, selectedCommunity.id, inviteId);
      setInvites((prev) =>
        prev.map((inv) =>
          inv.id === inviteId
            ? { ...inv, revokedAt: inv.revokedAt ?? new Date().toISOString() }
            : inv,
        ),
      );
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : 'Revoke invite failed');
    } finally {
      setInviteBusy(false);
    }
  };

  const copyInviteLink = async () => {
    if (!lastCreatedToken) return;
    const url = guildInviteShareUrl(lastCreatedToken);
    try {
      await navigator.clipboard.writeText(url);
      setCopyNotice('Invite link copied.');
    } catch {
      setCopyNotice(url);
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
          Communities are early access — browse, feeds, join/leave, members, and private invites hit the real API.
          Private = unlisted from Discover; open join is closed (invite redeem only). Feeds and members require membership.
          Owner and Member roles show when the membership API returns them. No kick/ban tools.
          {mineLoaded && !mineAvailable
            ? ' Membership list API is not available yet; joined state may not persist across reloads.'
            : ' Your Communities reflects server memberships when available.'}
        </div>
        <div className="flex" role="tablist" aria-label="Communities filters">
          {TABS.map((tab) => {
            const selected = activeTab === tab;
            return (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setActiveTab(tab)}
                className="flex-1 py-4 text-[15px] font-medium transition-colors hover-overlay focus-visible:outline-none focus-ring"
                style={{ color: selected ? 'var(--text-primary)' : 'var(--text-secondary)' }}
              >
                <span className="relative inline-block">
                  {tab}
                  {selected && (
                    <span className="absolute -bottom-[17px] left-0 right-0 h-[4px] rounded-full" style={{ backgroundColor: 'var(--accent)' }} aria-hidden="true" />
                  )}
                </span>
              </button>
            );
          })}
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
              className="-ml-2 mb-3 flex h-9 items-center gap-2 rounded-full px-3 text-[15px] font-bold transition-colors hover-overlay focus-visible:outline-none focus-ring"
              style={{ color: 'var(--text-primary)' }}
              aria-label="Back to communities"
            >
              <ArrowLeft size={18} strokeWidth={2.25} aria-hidden="true" />
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
                {isPrivateGuild(selectedCommunity.visibility) && (
                  <p className="mt-2 text-[13px] leading-5" style={{ color: 'var(--text-secondary)' }} role="note">
                    {privateGuildJoinCtaCopy(joinedIds.has(selectedCommunity.id))}
                  </p>
                )}
                {selectedCommunity.slug && (
                  <p className="mt-1 text-[12px]" style={{ color: 'var(--text-secondary)' }}>
                    Slug: {selectedCommunity.slug}
                    {isPrivateGuild(selectedCommunity.visibility)
                      ? ' — open join closed; owners create invite links below.'
                      : ''}
                  </p>
                )}
              </div>

              <JoinButton
                communityId={selectedCommunity.id}
                joined={joinedIds.has(selectedCommunity.id)}
                busy={membershipBusyId === selectedCommunity.id}
                authEnabled={authEnabled}
                isSignedIn={isSignedIn}
                privateGuild={isPrivateGuild(selectedCommunity.visibility)}
                onToggle={(id) => void toggleMembership(id)}
              />
            </div>
          </div>

          {/* Owner invite management */}
          {isOwner && (
            <div className="border-b px-4 py-4" style={{ borderColor: 'var(--border-primary)' }}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-[15px] font-bold">Invites</h3>
                <button
                  type="button"
                  disabled={inviteBusy}
                  onClick={() => void handleCreateInvite()}
                  className="rounded-full px-4 py-1.5 text-[13px] font-bold transition-opacity hover:opacity-90 disabled:opacity-50"
                  style={{ backgroundColor: 'var(--accent)', color: 'var(--bg-primary)' }}
                >
                  {inviteBusy ? 'Working…' : 'Create invite'}
                </button>
              </div>
              <p className="mt-1 text-[12px]" style={{ color: 'var(--text-secondary)' }}>
                New invites default to 25 uses and 14-day expiry. Token is shown once — copy the link immediately.
              </p>
              {inviteError && (
                <p className="mt-2 text-[13px]" style={{ color: 'var(--danger, #f4212e)' }} role="alert">
                  {inviteError}
                </p>
              )}
              {lastCreatedToken && (
                <div
                  className="mt-3 rounded-xl border p-3"
                  style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-elevated)' }}
                >
                  <p className="text-[13px] font-medium">New invite link (shown once)</p>
                  <p className="mt-1 break-all text-[12px]" style={{ color: 'var(--text-secondary)' }}>
                    {guildInviteShareUrl(lastCreatedToken)}
                  </p>
                  <button
                    type="button"
                    onClick={() => void copyInviteLink()}
                    className="mt-2 rounded-full border px-3 py-1 text-[12px] font-bold transition-colors hover-overlay"
                    style={{ borderColor: 'var(--border-secondary)' }}
                  >
                    Copy link
                  </button>
                  {copyNotice && (
                    <p className="mt-1 text-[12px]" style={{ color: 'var(--text-secondary)' }} role="status">
                      {copyNotice}
                    </p>
                  )}
                </div>
              )}
              {invitesLoading && <LoadingState label="Loading invites" />}
              {!invitesLoading && invites.length === 0 && (
                <p className="mt-3 text-[13px]" style={{ color: 'var(--text-secondary)' }}>
                  No invites yet.
                </p>
              )}
              {!invitesLoading && invites.length > 0 && (
                <ul className="mt-3 space-y-2">
                  {invites.map((inv) => {
                    const revoked = Boolean(inv.revokedAt);
                    return (
                      <li
                        key={inv.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2 text-[13px]"
                        style={{ borderColor: 'var(--border-primary)' }}
                      >
                        <div className="min-w-0">
                          <span className="font-medium">
                            {revoked ? 'Revoked' : 'Active'}
                          </span>
                          <span style={{ color: 'var(--text-secondary)' }}>
                            {' '}
                            · uses {inv.useCount}
                            {inv.maxUses != null ? `/${inv.maxUses}` : ''}
                            {inv.expiresAt ? ` · expires ${inv.expiresAt}` : ''}
                          </span>
                        </div>
                        {!revoked && (
                          <button
                            type="button"
                            disabled={inviteBusy}
                            onClick={() => void handleRevokeInvite(inv.id)}
                            className="rounded-full border px-3 py-1 text-[12px] font-bold transition-colors hover-overlay disabled:opacity-50"
                            style={{ borderColor: 'var(--border-secondary)' }}
                          >
                            Revoke
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}

          {/* Members list */}
          {(!isPrivateGuild(selectedCommunity.visibility) || joinedIds.has(selectedCommunity.id)) && (
            <div className="border-b px-4 py-4" style={{ borderColor: 'var(--border-primary)' }}>
              <h3 className="text-[15px] font-bold">Members</h3>
              {membersLoading && <LoadingState label="Loading members" />}
              {!membersLoading && membersError && (
                <p className="mt-2 text-[13px]" style={{ color: 'var(--danger, #f4212e)' }} role="alert">
                  {membersError}
                </p>
              )}
              {!membersLoading && !membersError && members.length === 0 && (
                <p className="mt-2 text-[13px]" style={{ color: 'var(--text-secondary)' }}>
                  No members returned yet.
                </p>
              )}
              {!membersLoading && !membersError && members.length > 0 && (
                <ul className="mt-3 space-y-2">
                  {members.map((m) => {
                    const label = membershipRoleLabel(m.role) ?? 'Member';
                    return (
                      <li key={m.profileId} className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <Link
                            to={`/profile/${encodeURIComponent(m.handle)}`}
                            className="text-[14px] font-semibold underline-offset-2 hover:underline"
                            style={{ color: 'var(--text-primary)' }}
                          >
                            {m.displayName || m.handle}
                          </Link>
                          <span className="ml-1 text-[13px]" style={{ color: 'var(--text-secondary)' }}>
                            @{m.handle}
                          </span>
                        </div>
                        <span
                          className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide"
                          style={{
                            backgroundColor:
                              label === 'Owner'
                                ? 'color-mix(in srgb, var(--accent) 18%, transparent)'
                                : 'color-mix(in srgb, var(--text-secondary) 14%, transparent)',
                            color: label === 'Owner' ? 'var(--accent)' : 'var(--text-secondary)',
                          }}
                        >
                          {label}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}

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
              onLike={(id, liked, token) => (liked ? likePost(token, id) : unlikePost(token, id))}
              onRepost={(id, reposted, token) => (reposted ? repostPost : unrepostPost)(token, id)}
              onBookmark={(id, bookmarked, token) =>
                bookmarked ? bookmarkPost(token, id) : unbookmarkPost(token, id)
              }
              onDelete={(id) => {
                setFeedPosts((current) => current.filter((p) => p.id !== id));
              }}
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
                aria-label={`${community.name}${joined ? ', joined' : ''}${isPrivateGuild(community.visibility) ? ', private' : ''}`}
                onClick={() => setSelectedCommunityId(community.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setSelectedCommunityId(community.id);
                  }
                }}
                className="cursor-pointer overflow-hidden rounded-2xl border transition-colors hover:bg-white/[0.03] focus-visible:outline-none focus-ring"
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
                      privateGuild={isPrivateGuild(community.visibility)}
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
