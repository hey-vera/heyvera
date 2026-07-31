import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { ArrowLeft, CalendarDays, Flag, ImagePlus, Link as LinkIcon, MapPin, MessageCircle, ShieldOff, VolumeX, X } from 'lucide-react';
import { SignInButton } from '@clerk/clerk-react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  blockUser,
  bookmarkPost,
  createConversation,
  createProfile,
  feedPostToPost,
  fetchFollowStatus,
  fetchMyProfile,
  fetchProfile,
  fetchProfileFeed,
  fetchProfileFollowers,
  fetchProfileFollowing,
  fetchProfileStats,
  followProfile,
  getConversations,
  likePost,
  muteUser,
  reportContent,
  repostPost,
  unbookmarkPost,
  unfollowProfile,
  unlikePost,
  unrepostPost,
  updateProfile,
  uploadMediaFile,
} from '../api/social';
import type { Profile, ProfileStats, ProfileSummary } from '../api/social';
import type { Post } from '../api/types';
import { EmptyState, ErrorState, LoadingState } from '../components/shared/AsyncStates';
import { PostCard } from '../components/shared/PostCard';
import { useAuth } from '../hooks/useAuth';
import { ALLOWED_IMAGE_ACCEPT, validateImageFile } from '../utils/imageUpload';
import {
  mapReportToApiBody,
  REPORT_REASON_CHOICES,
  type UiReportReason,
} from '../utils/moderation';
import {
  mapBookmarkInPosts,
  mapLikeInPosts,
  mapRepostInPosts,
  withOptimisticPostMutation,
} from '../utils/optimisticPostMutation';
import { renderRichText } from '../utils/richText';

const TABS = ['Posts', 'Replies', 'Media', 'Likes'] as const;
type Tab = typeof TABS[number];
type FollowListMode = 'followers' | 'following' | null;

const EMPTY_TAB_COPY: Record<Tab, { title: string; detail: string }> = {
  Posts: {
    title: 'No posts yet',
    detail: 'Posts from this profile will appear here.',
  },
  Replies: {
    title: 'No replies yet',
    detail: 'Replies will appear here when this profile has reply posts.',
  },
  Media: {
    title: 'No media posts yet',
    detail: 'Posts with media attachments will appear here.',
  },
  Likes: {
    title: 'No liked posts yet',
    detail: 'Posts liked from this loaded profile feed will appear here.',
  },
};

function formatCount(count: number): string {
  if (count < 1000) return String(count);
  if (count < 1_000_000) return `${(count / 1000).toFixed(count < 10000 ? 1 : 0).replace(/\.0$/, '')}K`;
  return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
}

function formatJoinedDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

export function ProfilePage() {
  const { handle } = useParams<{ handle?: string }>();
  const navigate = useNavigate();
  const { authEnabled, isSignedIn, getToken, viewerLabel } = useAuth();
  const ownProfile = !handle;
  const [activeTab, setActiveTab] = useState<Tab>('Posts');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [stats, setStats] = useState<ProfileStats | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [isFollowing, setIsFollowing] = useState(false);
  const [followPending, setFollowPending] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);
  const [followError, setFollowError] = useState<string | null>(null);
  const [messageBusy, setMessageBusy] = useState(false);
  const [messageError, setMessageError] = useState<string | null>(null);
  const [moderationBusy, setModerationBusy] = useState(false);
  const [moderationNotice, setModerationNotice] = useState<string | null>(null);
  const [reportPickerOpen, setReportPickerOpen] = useState(false);
  const [followListMode, setFollowListMode] = useState<FollowListMode>(null);
  const [followList, setFollowList] = useState<ProfileSummary[]>([]);
  const [followListLoading, setFollowListLoading] = useState(false);
  const [followListError, setFollowListError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function loadProfile() {
      setLoading(true);
      setError(null);
      setCreateError(null);
      setFollowPending(false);
      try {
        if (ownProfile) {
          if (!authEnabled || !isSignedIn) {
            if (!cancelled) {
              setProfile(null);
              setStats(null);
              setPosts([]);
              setIsFollowing(false);
            }
            return;
          }

          const token = await getToken();
          if (!token) throw new Error('Sign in again to load your profile.');

          let nextProfile: Profile;
          try {
            const res = await fetchMyProfile(token);
            nextProfile = res.profile;
          } catch {
            // 404 means profile not created yet
            if (!cancelled) {
              setProfile(null);
              setStats(null);
              setPosts([]);
              setIsFollowing(false);
            }
            return;
          }

          const tokenForFeed = await getToken();
          const [feedRes, statsRes] = await Promise.all([
            fetchProfileFeed(nextProfile.handle, 20, null, tokenForFeed),
            fetchProfileStats(nextProfile.handle, tokenForFeed),
          ]);
          if (!cancelled) {
            setProfile(nextProfile);
            setStats(statsRes.stats);
            setPosts(feedRes.feed.map(feedPostToPost));
            setIsFollowing(false);
          }
          return;
        }

        const token = authEnabled && isSignedIn ? await getToken() : null;
        const [profileRes, feedRes, statsRes] = await Promise.all([
          fetchProfile(handle, token),
          fetchProfileFeed(handle, 20, null, token),
          fetchProfileStats(handle, token),
        ]);
        // Prefer isFollowing from profile payload; fall back to dedicated follow-status route.
        let following = Boolean(profileRes.profile.isFollowing);
        let pending = false;
        if (token) {
          try {
            const followRes = await fetchFollowStatus(token, handle);
            following = followRes.following;
            pending = Boolean(followRes.pending);
          } catch {
            // ignore — treat as not following
          }
        }
        if (!cancelled) {
          setProfile(profileRes.profile);
          setStats(statsRes.stats);
          setPosts(feedRes.feed.map(feedPostToPost));
          setIsFollowing(following);
          setFollowPending(pending);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unable to load profile');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadProfile();
    return () => {
      cancelled = true;
    };
  }, [authEnabled, getToken, handle, isSignedIn, ownProfile, reloadKey]);

  const handleCreateProfile = async (input: { handle: string; displayName: string; bio?: string }) => {
    if (creating) return;
    setCreating(true);
    setCreateError(null);

    try {
      const token = await getToken();
      if (!token) throw new Error('Sign in again to create your profile.');

      const res = await createProfile(token, input);
      const nextProfile = res.profile;
      let nextPosts: Post[] = [];
      try {
        const feedRes = await fetchProfileFeed(nextProfile.handle);
        nextPosts = feedRes.feed.map(feedPostToPost);
      } catch {
        nextPosts = [];
      }

      setProfile(nextProfile);
      setPosts(nextPosts);
      setIsFollowing(false);
      setActiveTab('Posts');
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Unable to create profile');
    } finally {
      setCreating(false);
    }
  };

  const handleUpdateProfile = async (input: {
    displayName?: string;
    bio?: string;
    avatarUrl?: string;
    bannerUrl?: string;
    location?: string;
    websiteUrl?: string;
  }) => {
    if (savingEdit) return;
    setSavingEdit(true);
    setEditError(null);

    try {
      const token = await getToken();
      if (!token) throw new Error('Sign in again to update your profile.');

      const res = await updateProfile(token, input);
      setProfile(res.profile);
      setEditOpen(false);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Unable to update profile');
    } finally {
      setSavingEdit(false);
    }
  };

  const runModeration = async (kind: 'block' | 'mute') => {
    if (!profile || moderationBusy || ownProfile) return;
    setModerationNotice(null);
    setModerationBusy(true);
    try {
      if (!authEnabled || !isSignedIn) {
        throw new Error(authEnabled ? 'Sign in to moderate.' : 'Sign-in is not configured.');
      }
      const token = await getToken();
      if (!token) throw new Error('Sign in again.');
      if (kind === 'block') {
        await blockUser(token, profile.id);
        setModerationNotice(`Blocked @${profile.handle}`);
        setPosts([]);
      } else {
        await muteUser(token, profile.id);
        setModerationNotice(`Muted @${profile.handle}`);
        setPosts([]);
      }
    } catch (err) {
      setModerationNotice(err instanceof Error ? err.message : 'Action failed.');
    } finally {
      setModerationBusy(false);
    }
  };

  const openReportPicker = () => {
    if (!profile || moderationBusy || ownProfile) return;
    setModerationNotice(null);
    if (!authEnabled || !isSignedIn) {
      setModerationNotice(authEnabled ? 'Sign in to report.' : 'Sign-in is not configured.');
      return;
    }
    setReportPickerOpen(true);
  };

  const submitReport = async (reason: UiReportReason) => {
    if (!profile || moderationBusy || ownProfile) return;
    setModerationNotice(null);
    setModerationBusy(true);
    try {
      if (!authEnabled || !isSignedIn) {
        throw new Error(authEnabled ? 'Sign in to report.' : 'Sign-in is not configured.');
      }
      const token = await getToken();
      if (!token) throw new Error('Sign in again.');
      await reportContent(
        token,
        mapReportToApiBody({
          targetType: 'user',
          targetId: profile.id,
          reason,
        }),
      );
      setReportPickerOpen(false);
      setModerationNotice('Report submitted');
    } catch (err) {
      // Keep picker open on failure — no silent fake success.
      setModerationNotice(err instanceof Error ? err.message : 'Could not submit report.');
    } finally {
      setModerationBusy(false);
    }
  };

  const toggleFollow = async () => {
    if (!profile || followBusy) return;

    setFollowError(null);

    if (!authEnabled || !isSignedIn) {
      setFollowError(authEnabled ? 'Sign in to follow profiles.' : 'Sign-in is not configured for this environment.');
      return;
    }

    setFollowBusy(true);
    const previousFollowing = isFollowing;
    const previousPending = followPending;
    const removing = isFollowing || followPending;
    const nextFollowing = !removing;
    setIsFollowing(nextFollowing);
    setFollowPending(false);

    try {
      const token = await getToken();
      if (!token) throw new Error('Sign in again to follow profiles.');

      try {
        await fetchMyProfile(token);
      } catch {
        throw new Error('Create your profile before following people.');
      }

      if (removing) {
        await unfollowProfile(token, profile.handle);
      } else {
        const result = await followProfile(token, profile.handle);
        if (result.state === 'pending') {
          setIsFollowing(false);
          setFollowPending(true);
        }
      }
    } catch (err) {
      setIsFollowing(previousFollowing);
      setFollowPending(previousPending);
      setFollowError(err instanceof Error ? err.message : 'Unable to update follow state.');
    } finally {
      setFollowBusy(false);
    }
  };

  const openFollowList = async (mode: 'followers' | 'following') => {
    if (!profile) return;
    setFollowListMode(mode);
    setFollowListLoading(true);
    setFollowListError(null);
    setFollowList([]);
    try {
      const token = authEnabled && isSignedIn ? await getToken() : null;
      if (mode === 'followers') {
        const res = await fetchProfileFollowers(profile.handle, 20, null, token);
        setFollowList(res.followers);
      } else {
        const res = await fetchProfileFollowing(profile.handle, 20, null, token);
        setFollowList(res.following);
      }
    } catch (err) {
      setFollowListError(err instanceof Error ? err.message : `Unable to load ${mode}`);
    } finally {
      setFollowListLoading(false);
    }
  };

  const startMessage = async () => {
    if (!profile || messageBusy || ownProfile) return;
    setMessageError(null);

    if (!authEnabled || !isSignedIn) {
      setMessageError(authEnabled ? 'Sign in to send messages.' : 'Sign-in is not configured for this environment.');
      return;
    }

    setMessageBusy(true);
    try {
      const token = await getToken();
      if (!token) throw new Error('Sign in again to message.');

      try {
        await fetchMyProfile(token);
      } catch {
        throw new Error('Create your profile before messaging.');
      }

      // Belt+suspenders: prefer existing 1:1 if list already has the other profile.
      // Backend also dedupes on create for the same pair.
      try {
        const existing = await getConversations(token);
        const match = existing.find((c) => {
          const ids = (c.participants ?? []).map((p) => p.id);
          return ids.length === 2 && ids.includes(profile.id);
        });
        if (match) {
          navigate(`/messages?c=${encodeURIComponent(match.id)}`);
          return;
        }
      } catch {
        // Fall through to createConversation.
      }

      const conversation = await createConversation(token, [profile.id]);
      navigate(`/messages?c=${encodeURIComponent(conversation.id)}`);
    } catch (err) {
      setMessageError(err instanceof Error ? err.message : 'Unable to start conversation.');
    } finally {
      setMessageBusy(false);
    }
  };

  const handleLike = (id: string, liked: boolean, token: string) => {
    let snapshot: Post[] | null = null;
    return withOptimisticPostMutation({
      apply: () => {
        setPosts((current) => {
          snapshot = current;
          return mapLikeInPosts(current, id, liked);
        });
      },
      mutate: () => (liked ? likePost(token, id) : unlikePost(token, id)),
      revert: () => {
        if (snapshot) setPosts(snapshot);
      },
    });
  };

  const handleRepost = (id: string, reposted: boolean, token: string) => {
    let snapshot: Post[] | null = null;
    return withOptimisticPostMutation({
      apply: () => {
        setPosts((current) => {
          snapshot = current;
          return mapRepostInPosts(current, id, reposted);
        });
      },
      mutate: () => (reposted ? repostPost : unrepostPost)(token, id),
      revert: () => {
        if (snapshot) setPosts(snapshot);
      },
    });
  };

  const handleBookmark = (id: string, bookmarked: boolean, token: string) => {
    let snapshot: Post[] | null = null;
    return withOptimisticPostMutation({
      apply: () => {
        setPosts((current) => {
          snapshot = current;
          return mapBookmarkInPosts(current, id, bookmarked);
        });
      },
      mutate: () => (bookmarked ? bookmarkPost(token, id) : unbookmarkPost(token, id)),
      revert: () => {
        if (snapshot) setPosts(snapshot);
      },
    });
  };

  if (loading) {
    return <LoadingState label="Loading profile" />;
  }

  if (ownProfile && (!authEnabled || !isSignedIn)) {
    return <SignedOutProfilePrompt authEnabled={authEnabled} />;
  }

  if (error) {
    return <ErrorState detail={error} onRetry={() => setReloadKey((key) => key + 1)} />;
  }

  if (ownProfile && !profile) {
    return (
      <ProfileSetupForm
        creating={creating}
        error={createError}
        defaultDisplayName={viewerLabel ?? ''}
        onSubmit={handleCreateProfile}
      />
    );
  }

  if (error || !profile) {
    return <ErrorState detail={error ?? 'Profile unavailable'} onRetry={() => setReloadKey((key) => key + 1)} />;
  }

  const visiblePosts = posts.filter((post) => {
    if (activeTab === 'Replies') return Boolean(post.reply_to);
    if (activeTab === 'Media') return Boolean(post.media?.length);
    if (activeTab === 'Likes') return post.liked;
    return true;
  });
  const emptyCopy = EMPTY_TAB_COPY[activeTab];

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
      <div className="sticky top-[var(--top-bar-height)] z-10 flex items-center gap-6 border-b sticky-header-bg px-4 py-3 backdrop-blur-md" style={{ borderColor: 'var(--border-primary)' }}>
        <button type="button" onClick={() => navigate(-1)} className="rounded-full p-2 transition-colors hover-overlay" aria-label="Back">
          <ArrowLeft className="h-5 w-5" aria-hidden="true" />
        </button>
        <div>
          <h1 className="text-[20px] font-bold leading-tight">{profile.displayName}</h1>
          <p className="text-[13px]" style={{ color: 'var(--text-secondary)' }}>{stats?.postCount ?? 0} posts</p>
        </div>
      </div>

      <div className="relative">
        {profile.bannerUrl ? (
          <img src={profile.bannerUrl} alt="" className="h-[200px] w-full object-cover" />
        ) : (
          <div className="h-[200px] w-full" style={{ backgroundColor: 'var(--border-primary)' }} />
        )}

        <div className="absolute -bottom-16 left-4">
          {profile.avatarUrl ? (
            <img
              src={profile.avatarUrl}
              alt={profile.displayName}
              className="h-[134px] w-[134px] rounded-full border-4 border-[var(--bg-primary)] object-cover"
              style={{ backgroundColor: 'var(--border-primary)' }}
            />
          ) : (
            <div
              className="flex h-[134px] w-[134px] items-center justify-center rounded-full border-4 border-[var(--bg-primary)] text-4xl font-bold"
              style={{ backgroundColor: 'var(--border-primary)', color: 'var(--text-secondary)' }}
            >
              {profile.displayName.charAt(0)}
            </div>
          )}
        </div>

        <div className="absolute bottom-3 right-4 flex flex-wrap items-center justify-end gap-2">
          {!ownProfile && (
            <>
              <button
                type="button"
                onClick={() => void startMessage()}
                disabled={messageBusy}
                className="flex items-center gap-1.5 rounded-full border px-4 py-1.5 text-[14px] font-bold transition-colors hover:opacity-90 disabled:opacity-50"
                style={{
                  borderColor: 'var(--border-primary)',
                  backgroundColor: 'transparent',
                  color: 'var(--text-primary)',
                }}
                aria-label={`Message @${profile.handle}`}
              >
                <MessageCircle className="h-4 w-4" aria-hidden="true" />
                {messageBusy ? 'Opening…' : 'Message'}
              </button>
              <button
                type="button"
                onClick={() => void runModeration('mute')}
                disabled={moderationBusy}
                className="flex items-center gap-1 rounded-full border px-3 py-1.5 text-[13px] font-bold transition-colors hover:opacity-90 disabled:opacity-50"
                style={{ borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}
                aria-label={`Mute @${profile.handle}`}
              >
                <VolumeX className="h-4 w-4" aria-hidden="true" />
                Mute
              </button>
              <button
                type="button"
                onClick={() => void runModeration('block')}
                disabled={moderationBusy}
                className="flex items-center gap-1 rounded-full border px-3 py-1.5 text-[13px] font-bold transition-colors hover:opacity-90 disabled:opacity-50"
                style={{ borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}
                aria-label={`Block @${profile.handle}`}
              >
                <ShieldOff className="h-4 w-4" aria-hidden="true" />
                Block
              </button>
              <button
                type="button"
                onClick={openReportPicker}
                disabled={moderationBusy}
                className="flex items-center gap-1 rounded-full border px-3 py-1.5 text-[13px] font-bold transition-colors hover:opacity-90 disabled:opacity-50"
                style={{ borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}
                aria-label={`Report @${profile.handle}`}
              >
                <Flag className="h-4 w-4" aria-hidden="true" />
                Report
              </button>
            </>
          )}
          <button
            type="button"
            onClick={ownProfile ? () => setEditOpen(true) : toggleFollow}
            disabled={!ownProfile && followBusy}
            className="rounded-full px-4 py-1.5 text-[14px] font-bold transition-colors hover:opacity-90 focus-visible:outline-none focus-ring"
            style={{
              border: ownProfile || isFollowing || followPending ? '1px solid var(--border-primary)' : undefined,
              backgroundColor: ownProfile || isFollowing || followPending ? 'transparent' : 'var(--accent)',
              color: ownProfile || isFollowing || followPending ? 'var(--text-primary)' : '#000',
            }}
            aria-pressed={ownProfile ? undefined : isFollowing}
            aria-busy={!ownProfile && followBusy ? true : undefined}
          >
            {ownProfile
              ? 'Edit profile'
              : followBusy
                ? 'Saving'
                : isFollowing
                  ? 'Following'
                  : followPending
                    ? 'Requested'
                    : 'Follow'}
          </button>
        </div>
      </div>

      <section className="mt-20 px-4 pb-4">
        <h2 className="text-[23px] font-bold leading-tight">
          {profile.displayName}
        </h2>
        <p className="text-[15px]" style={{ color: 'var(--text-secondary)' }}>@{profile.handle}</p>

        <p className="mt-3 whitespace-pre-wrap text-[15px] leading-relaxed">{renderRichText(profile.bio)}</p>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px]" style={{ color: 'var(--text-secondary)' }}>
          {profile.location && (
            <span className="flex items-center gap-1">
              <MapPin className="h-4 w-4" aria-hidden="true" />
              {profile.location}
            </span>
          )}
          {profile.websiteUrl && (
            <a href={profile.websiteUrl} className="flex items-center gap-1 hover:underline" style={{ color: 'var(--accent)' }}>
              <LinkIcon className="h-4 w-4" aria-hidden="true" />
              {profile.websiteUrl.replace(/^https?:\/\//, '')}
            </a>
          )}
          <span className="flex items-center gap-1">
            <CalendarDays className="h-4 w-4" aria-hidden="true" />
            Joined {formatJoinedDate(profile.createdAt)}
          </span>
        </div>

        <div className="mt-3 flex gap-5">
          <button
            type="button"
            onClick={() => void openFollowList('following')}
            className="flex gap-1 text-[15px] transition-colors hover:underline"
          >
            <span className="font-bold">{formatCount(stats?.followingCount ?? 0)}</span>
            <span style={{ color: 'var(--text-secondary)' }}>Following</span>
          </button>
          <button
            type="button"
            onClick={() => void openFollowList('followers')}
            className="flex gap-1 text-[15px] transition-colors hover:underline"
          >
            <span className="font-bold">{formatCount(stats?.followerCount ?? 0)}</span>
            <span style={{ color: 'var(--text-secondary)' }}>Followers</span>
          </button>
        </div>
        {followError && (
          <p className="mt-3 text-[14px]" style={{ color: 'var(--color-danger)' }}>
            {followError}
          </p>
        )}
        {messageError && (
          <p className="mt-3 text-[14px]" style={{ color: 'var(--color-danger)' }}>
            {messageError}
          </p>
        )}
        {moderationNotice && (
          <p className="mt-3 text-[14px]" style={{ color: 'var(--text-secondary)' }} role="status">
            {moderationNotice}
          </p>
        )}
        {reportPickerOpen && !ownProfile && (
          <div
            className="mt-3 rounded-2xl border p-4"
            style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-elevated)' }}
            role="dialog"
            aria-label="Report reason"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-[15px] font-bold">Report @{profile.handle}</p>
                <p className="mt-1 text-[13px]" style={{ color: 'var(--text-secondary)' }}>
                  Why are you reporting this profile?
                </p>
              </div>
              <button
                type="button"
                className="rounded-full px-2 py-1 text-[13px] font-bold transition-colors hover-overlay"
                style={{ color: 'var(--text-secondary)' }}
                onClick={() => setReportPickerOpen(false)}
                disabled={moderationBusy}
              >
                Cancel
              </button>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {REPORT_REASON_CHOICES.map((choice) => (
                <button
                  key={choice.id}
                  type="button"
                  disabled={moderationBusy}
                  onClick={() => void submitReport(choice.id)}
                  className="rounded-full border px-4 py-1.5 text-[13px] font-bold transition-colors hover-overlay disabled:opacity-50"
                  style={{ borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}
                >
                  {choice.label}
                </button>
              ))}
            </div>
            {moderationBusy && (
              <p className="mt-2 text-[12px]" style={{ color: 'var(--text-secondary)' }} role="status">
                Submitting report…
              </p>
            )}
          </div>
        )}
      </section>

      {followListMode && (
        <FollowListPanel
          mode={followListMode}
          profiles={followList}
          loading={followListLoading}
          error={followListError}
          onClose={() => {
            setFollowListMode(null);
            setFollowList([]);
            setFollowListError(null);
          }}
          onSelectHandle={(h) => {
            setFollowListMode(null);
            navigate(`/profile/${h}`);
          }}
        />
      )}

      <div
        className="flex border-b"
        style={{ borderColor: 'var(--border-primary)' }}
        role="tablist"
        aria-label="Profile content"
      >
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

      {visiblePosts.length === 0 ? (
        <EmptyState title={emptyCopy.title} detail={emptyCopy.detail} />
      ) : (
        visiblePosts.map((post) => (
          <PostCard
            key={post.id}
            post={post}
            onLike={handleLike}
            onRepost={handleRepost}
            onBookmark={handleBookmark}
            onDelete={(id) => {
              setPosts((current) => current.filter((p) => p.id !== id));
            }}
          />
        ))
      )}

      {ownProfile && editOpen && (
        <EditProfileModal
          profile={profile}
          saving={savingEdit}
          error={editError}
          getToken={getToken}
          onClose={() => {
            setEditOpen(false);
            setEditError(null);
          }}
          onSubmit={handleUpdateProfile}
        />
      )}
    </div>
  );
}

export default ProfilePage;

function SignedOutProfilePrompt({ authEnabled }: { authEnabled: boolean }) {
  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
      <div className="sticky top-[var(--top-bar-height)] z-10 border-b sticky-header-bg px-4 py-3 backdrop-blur-md" style={{ borderColor: 'var(--border-primary)' }}>
        <h1 className="text-[20px] font-bold leading-tight">Profile</h1>
      </div>
      <section className="px-6 py-12">
        <div className="mx-auto flex max-w-sm flex-col items-start gap-4">
          <div>
            <h2 className="text-[23px] font-bold leading-tight">Sign in to view your profile</h2>
            <p className="mt-2 text-[15px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              Create or manage your HeyVera profile after signing in.
            </p>
          </div>
          {authEnabled ? (
            <SignInButton mode="modal">
              <button
                type="button"
                className="rounded-full px-5 py-2 text-[15px] font-bold transition-colors hover:opacity-90"
                style={{ backgroundColor: 'var(--accent)', color: '#000' }}
              >
                Sign in
              </button>
            </SignInButton>
          ) : (
            <p className="text-[13px]" style={{ color: 'var(--text-secondary)' }}>
              Sign-in is not configured for this environment.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}

type ProfileSetupFormProps = {
  creating: boolean;
  error: string | null;
  defaultDisplayName: string;
  onSubmit: (input: { handle: string; displayName: string; bio?: string }) => void;
};

function ProfileSetupForm({ creating, error, defaultDisplayName, onSubmit }: ProfileSetupFormProps) {
  const [handle, setHandle] = useState('');
  const [displayName, setDisplayName] = useState(defaultDisplayName);
  const [bio, setBio] = useState('');

  const cleanHandle = handle.trim().replace(/^@/, '').toLowerCase();
  const cleanDisplayName = displayName.trim();
  const canSubmit = cleanHandle.length >= 2 && cleanDisplayName.length > 0 && !creating;

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
      <div className="sticky top-[var(--top-bar-height)] z-10 border-b sticky-header-bg px-4 py-3 backdrop-blur-md" style={{ borderColor: 'var(--border-primary)' }}>
        <h1 className="text-[20px] font-bold leading-tight">Profile</h1>
      </div>
      <form
        className="border-b px-4 py-5"
        style={{ borderColor: 'var(--border-primary)' }}
        onSubmit={(event) => {
          event.preventDefault();
          if (!canSubmit) return;
          onSubmit({
            handle: cleanHandle,
            displayName: cleanDisplayName,
            bio: bio.trim() || undefined,
          });
        }}
      >
        <div className="mb-5">
          <h2 className="text-[23px] font-bold leading-tight">Create your profile</h2>
          <p className="mt-1 text-[15px]" style={{ color: 'var(--text-secondary)' }}>
            Pick the identity people will see on HeyVera.
          </p>
        </div>

        <div className="flex flex-col gap-4">
          <label className="block">
            <span className="mb-1 block text-[13px]" style={{ color: 'var(--text-secondary)' }}>Handle</span>
            <div className="flex rounded-md border px-3 py-2 focus-within:border-[var(--accent)]" style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-elevated)' }}>
              <span className="text-[15px]" style={{ color: 'var(--text-secondary)' }}>@</span>
              <input
                value={handle}
                onChange={(event) => setHandle(event.target.value)}
                className="min-w-0 flex-1 bg-transparent text-[15px] outline-none"
                style={{ color: 'var(--text-primary)' }}
                placeholder="handle"
                pattern="[A-Za-z0-9_\\-]{2,32}"
                maxLength={32}
                disabled={creating}
                required
              />
            </div>
          </label>

          <label className="block">
            <span className="mb-1 block text-[13px]" style={{ color: 'var(--text-secondary)' }}>Display name</span>
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              className="w-full rounded-md border bg-transparent px-3 py-2 text-[15px] outline-none focus:border-[var(--accent)]"
              style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-elevated)', color: 'var(--text-primary)' }}
              placeholder="Your name"
              maxLength={80}
              disabled={creating}
              required
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-[13px]" style={{ color: 'var(--text-secondary)' }}>Bio</span>
            <textarea
              value={bio}
              onChange={(event) => setBio(event.target.value)}
              className="min-h-24 w-full resize-none rounded-md border bg-transparent px-3 py-2 text-[15px] leading-relaxed outline-none focus:border-[var(--accent)]"
              style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-elevated)', color: 'var(--text-primary)' }}
              placeholder="What are you building or following?"
              maxLength={280}
              disabled={creating}
            />
          </label>
        </div>

        {error && <p className="mt-3 text-[13px]" style={{ color: 'var(--color-danger)' }}>{error}</p>}

        <div className="mt-5 flex justify-end">
          <button
            type="submit"
            disabled={!canSubmit}
            className="rounded-full px-5 py-2 text-[15px] font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-50 enabled:hover:opacity-90"
            style={{ backgroundColor: 'var(--accent)', color: '#000' }}
          >
            {creating ? 'Creating...' : 'Create profile'}
          </button>
        </div>
      </form>
    </div>
  );
}

type EditProfileModalProps = {
  profile: Profile;
  saving: boolean;
  error: string | null;
  getToken: () => Promise<string | null>;
  onClose: () => void;
  onSubmit: (input: {
    displayName?: string;
    bio?: string;
    avatarUrl?: string;
    bannerUrl?: string;
    location?: string;
    websiteUrl?: string;
  }) => void;
};

function EditProfileModal({ profile, saving, error, getToken, onClose, onSubmit }: EditProfileModalProps) {
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [bio, setBio] = useState(profile.bio);
  const [location, setLocation] = useState(profile.location ?? '');
  const [website, setWebsite] = useState(profile.websiteUrl ?? '');
  const [avatarUrl, setAvatarUrl] = useState(profile.avatarUrl ?? '');
  const [bannerUrl, setBannerUrl] = useState(profile.bannerUrl ?? '');
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [bannerFile, setBannerFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [bannerPreview, setBannerPreview] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const bannerInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    return () => {
      if (avatarPreview) URL.revokeObjectURL(avatarPreview);
      if (bannerPreview) URL.revokeObjectURL(bannerPreview);
    };
  }, [avatarPreview, bannerPreview]);

  const cleanDisplayName = displayName.trim();
  const busy = saving || uploading;
  const canSave = cleanDisplayName.length > 0 && !busy;

  const clearAvatarFile = () => {
    if (avatarPreview) URL.revokeObjectURL(avatarPreview);
    setAvatarFile(null);
    setAvatarPreview(null);
    if (avatarInputRef.current) avatarInputRef.current.value = '';
  };

  const clearBannerFile = () => {
    if (bannerPreview) URL.revokeObjectURL(bannerPreview);
    setBannerFile(null);
    setBannerPreview(null);
    if (bannerInputRef.current) bannerInputRef.current.value = '';
  };

  const onPickImage = (kind: 'avatar' | 'banner', event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    if (!file) return;

    const validationError = validateImageFile(file);
    if (validationError) {
      setLocalError(validationError);
      if (kind === 'avatar') clearAvatarFile();
      else clearBannerFile();
      return;
    }

    const preview = URL.createObjectURL(file);
    if (kind === 'avatar') {
      if (avatarPreview) URL.revokeObjectURL(avatarPreview);
      setAvatarFile(file);
      setAvatarPreview(preview);
    } else {
      if (bannerPreview) URL.revokeObjectURL(bannerPreview);
      setBannerFile(file);
      setBannerPreview(preview);
    }
    setLocalError(null);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSave) return;

    setLocalError(null);
    let nextAvatarUrl = avatarUrl.trim() || undefined;
    let nextBannerUrl = bannerUrl.trim() || undefined;

    try {
      if (avatarFile || bannerFile) {
        setUploading(true);
        const token = await getToken();
        if (!token) throw new Error('Sign in again to update your profile.');

        if (avatarFile) {
          const uploaded = await uploadMediaFile(token, avatarFile);
          nextAvatarUrl = uploaded.url;
          setAvatarUrl(uploaded.url);
        }
        if (bannerFile) {
          const uploaded = await uploadMediaFile(token, bannerFile);
          nextBannerUrl = uploaded.url;
          setBannerUrl(uploaded.url);
        }
      }

      onSubmit({
        displayName: cleanDisplayName,
        bio: bio.trim(),
        location: location.trim() || undefined,
        websiteUrl: website.trim() || undefined,
        avatarUrl: nextAvatarUrl,
        bannerUrl: nextBannerUrl,
      });
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Unable to upload image');
    } finally {
      setUploading(false);
    }
  };

  const avatarDisplay = avatarPreview || avatarUrl.trim() || profile.avatarUrl || null;
  const bannerDisplay = bannerPreview || bannerUrl.trim() || profile.bannerUrl || null;
  const formError = localError || error;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-10 sm:pt-16"
      style={{ backgroundColor: 'color-mix(in srgb, var(--bg-primary) 60%, transparent)' }}
      onClick={onClose}
    >
      <form
        className="w-full max-w-[600px] overflow-hidden rounded-2xl border"
        style={{ backgroundColor: 'var(--bg-primary)', borderColor: 'var(--border-primary)' }}
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => void handleSubmit(event)}
      >
        <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: 'var(--border-primary)' }}>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="rounded-full p-2 transition-colors hover-overlay disabled:opacity-50"
              aria-label="Close edit profile"
            >
              <ArrowLeft className="h-5 w-5" aria-hidden="true" />
            </button>
            <h2 className="text-[20px] font-bold">Edit profile</h2>
          </div>
          <button
            type="submit"
            disabled={!canSave}
            className="rounded-full px-5 py-1.5 text-[14px] font-bold transition-opacity disabled:cursor-not-allowed disabled:opacity-50 enabled:hover:opacity-90"
            style={{ backgroundColor: 'var(--text-primary)', color: 'var(--bg-primary)' }}
          >
            {uploading ? 'Uploading' : saving ? 'Saving' : 'Save'}
          </button>
        </div>

        <div className="max-h-[calc(100vh-140px)] overflow-y-auto px-4 py-5">
          <div className="grid gap-4">
            <div>
              <span className="mb-2 block text-[13px]" style={{ color: 'var(--text-secondary)' }}>Banner</span>
              <div
                className="relative h-[120px] overflow-hidden rounded-xl border"
                style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-elevated)' }}
              >
                {bannerDisplay ? (
                  <img src={bannerDisplay} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center text-[13px]" style={{ color: 'var(--text-secondary)' }}>
                    No banner
                  </div>
                )}
                {bannerFile ? (
                  <button
                    type="button"
                    onClick={clearBannerFile}
                    disabled={busy}
                    className="absolute right-2 top-2 rounded-full p-1.5 disabled:opacity-50"
                    style={{ backgroundColor: 'color-mix(in srgb, var(--bg-primary) 80%, transparent)', color: 'var(--text-primary)' }}
                    aria-label="Remove selected banner"
                  >
                    <X className="h-4 w-4" />
                  </button>
                ) : null}
              </div>
              <input
                ref={bannerInputRef}
                type="file"
                accept={ALLOWED_IMAGE_ACCEPT}
                className="hidden"
                onChange={(event) => onPickImage('banner', event)}
                disabled={busy}
              />
              <button
                type="button"
                onClick={() => bannerInputRef.current?.click()}
                disabled={busy}
                className="mt-2 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors hover-overlay disabled:opacity-50"
                style={{ color: 'var(--accent)' }}
              >
                <ImagePlus className="h-4 w-4" aria-hidden="true" />
                Upload banner
              </button>
              <ProfileEditField
                label="Banner URL (optional)"
                value={bannerUrl}
                onChange={(value) => {
                  setBannerUrl(value);
                  if (bannerFile) clearBannerFile();
                }}
                maxLength={500}
                disabled={busy}
              />
            </div>

            <div>
              <span className="mb-2 block text-[13px]" style={{ color: 'var(--text-secondary)' }}>Avatar</span>
              <div className="flex items-center gap-4">
                <div
                  className="relative h-20 w-20 shrink-0 overflow-hidden rounded-full border-2"
                  style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-elevated)' }}
                >
                  {avatarDisplay ? (
                    <img src={avatarDisplay} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-[12px]" style={{ color: 'var(--text-secondary)' }}>
                      —
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <input
                    ref={avatarInputRef}
                    type="file"
                    accept={ALLOWED_IMAGE_ACCEPT}
                    className="hidden"
                    onChange={(event) => onPickImage('avatar', event)}
                    disabled={busy}
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => avatarInputRef.current?.click()}
                      disabled={busy}
                      className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors hover-overlay disabled:opacity-50"
                      style={{ color: 'var(--accent)' }}
                    >
                      <ImagePlus className="h-4 w-4" aria-hidden="true" />
                      Upload avatar
                    </button>
                    {avatarFile ? (
                      <button
                        type="button"
                        onClick={clearAvatarFile}
                        disabled={busy}
                        className="text-sm disabled:opacity-50"
                        style={{ color: 'var(--text-secondary)' }}
                      >
                        Clear
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
              <div className="mt-2">
                <ProfileEditField
                  label="Avatar URL (optional)"
                  value={avatarUrl}
                  onChange={(value) => {
                    setAvatarUrl(value);
                    if (avatarFile) clearAvatarFile();
                  }}
                  maxLength={500}
                  disabled={busy}
                />
              </div>
            </div>

            <ProfileEditField
              label="Display name"
              value={displayName}
              onChange={setDisplayName}
              maxLength={80}
              required
              disabled={busy}
            />
            <label className="block">
              <span className="mb-1 block text-[13px]" style={{ color: 'var(--text-secondary)' }}>Bio</span>
              <textarea
                value={bio}
                onChange={(event) => setBio(event.target.value)}
                className="min-h-24 w-full resize-none rounded-md border bg-transparent px-3 py-2 text-[15px] leading-relaxed outline-none focus:border-[var(--accent)]"
                style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-elevated)', color: 'var(--text-primary)' }}
                maxLength={280}
                disabled={busy}
              />
            </label>
            <ProfileEditField label="Location" value={location} onChange={setLocation} maxLength={80} disabled={busy} />
            <ProfileEditField label="Website" value={website} onChange={setWebsite} maxLength={120} disabled={busy} />
          </div>

          {formError && <p className="mt-3 text-[13px]" style={{ color: 'var(--color-danger)' }}>{formError}</p>}
        </div>
      </form>
    </div>
  );
}

function ProfileEditField({
  label,
  value,
  onChange,
  maxLength,
  required,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  maxLength: number;
  required?: boolean;
  disabled?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[13px]" style={{ color: 'var(--text-secondary)' }}>{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-md border bg-transparent px-3 py-2 text-[15px] outline-none focus:border-[var(--accent)]"
        style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-elevated)', color: 'var(--text-primary)' }}
        maxLength={maxLength}
        required={required}
        disabled={disabled}
      />
    </label>
  );
}

function FollowListPanel({
  mode,
  profiles,
  loading,
  error,
  onClose,
  onSelectHandle,
}: {
  mode: 'followers' | 'following';
  profiles: ProfileSummary[];
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onSelectHandle: (handle: string) => void;
}) {
  const title = mode === 'followers' ? 'Followers' : 'Following';

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.55)' }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl border sm:rounded-2xl"
        style={{ backgroundColor: 'var(--bg-primary)', borderColor: 'var(--border-primary)' }}
      >
        <div
          className="flex items-center justify-between border-b px-4 py-3"
          style={{ borderColor: 'var(--border-primary)' }}
        >
          <h2 className="text-[18px] font-bold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 transition-colors hover-overlay"
            aria-label="Close"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        <div className="overflow-y-auto">
          {loading && <LoadingState label={`Loading ${title.toLowerCase()}`} />}
          {!loading && error && (
            <p className="px-4 py-6 text-[14px]" style={{ color: 'var(--color-danger)' }}>
              {error}
            </p>
          )}
          {!loading && !error && profiles.length === 0 && (
            <EmptyState
              title={`No ${title.toLowerCase()} yet`}
              detail={
                mode === 'followers'
                  ? 'People who follow this Page will show up here.'
                  : 'Pages this profile follows will show up here.'
              }
            />
          )}
          {!loading &&
            !error &&
            profiles.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => onSelectHandle(p.handle)}
                className="flex w-full items-center gap-3 border-b px-4 py-3 text-left transition-colors hover-overlay"
                style={{ borderColor: 'var(--border-primary)' }}
              >
                {p.avatarUrl ? (
                  <img
                    src={p.avatarUrl}
                    alt=""
                    className="h-10 w-10 rounded-full object-cover"
                    style={{ backgroundColor: 'var(--border-primary)' }}
                  />
                ) : (
                  <div
                    className="flex h-10 w-10 items-center justify-center rounded-full text-[14px] font-bold"
                    style={{ backgroundColor: 'var(--border-primary)', color: 'var(--text-secondary)' }}
                  >
                    {(p.displayName || p.handle).charAt(0)}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-bold" style={{ color: 'var(--text-primary)' }}>
                    {p.displayName}
                  </p>
                  <p className="truncate text-[13px]" style={{ color: 'var(--text-secondary)' }}>
                    @{p.handle}
                  </p>
                </div>
              </button>
            ))}
        </div>
      </div>
    </div>
  );
}
