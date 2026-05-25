import { useEffect, useState } from 'react';
import { ArrowLeft, CalendarDays, Link as LinkIcon, MapPin } from 'lucide-react';
import { SignInButton } from '@clerk/clerk-react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  bookmarkPost,
  createProfile,
  fetchFollowStatus,
  fetchMyProfile,
  fetchProfile,
  fetchProfileFeed,
  fetchProfileStats,
  followProfile,
  likePost,
  repostPost,
  unbookmarkPost,
  unfollowProfile,
  unlikePost,
  updateProfile,
} from '../api/social';
import type { FeedPost, Profile, ProfileStats } from '../api/social';
import type { Post } from '../api/types';
import { EmptyState, ErrorState, LoadingState } from '../components/shared/AsyncStates';
import { PostCard } from '../components/shared/PostCard';
import { useAuth } from '../hooks/useAuth';

/** Map a real FeedPost from the /v1/social API into the legacy Post shape that PostCard expects. */
function feedPostToLegacyPost(fp: FeedPost): Post {
  return {
    id: fp.id,
    content: fp.body,
    created_at: fp.createdAt,
    author: {
      id: fp.author.profileId,
      display_name: fp.author.displayName,
      handle: fp.author.handle,
      avatar_url: '',
      verified: false,
    },
    reply_count: 0,
    repost_count: 0,
    like_count: 0,
    view_count: 0,
    bookmarked: false,
    liked: false,
    reposted: false,
    reply_to: fp.replyToPostId ?? undefined,
  };
}

const TABS = ['Posts', 'Replies', 'Media', 'Likes'] as const;
type Tab = typeof TABS[number];

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
  const [followBusy, setFollowBusy] = useState(false);
  const [followError, setFollowError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function loadProfile() {
      setLoading(true);
      setError(null);
      setCreateError(null);
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

          const [feedRes, statsRes] = await Promise.all([
            fetchProfileFeed(nextProfile.handle),
            fetchProfileStats(nextProfile.handle),
          ]);
          if (!cancelled) {
            setProfile(nextProfile);
            setStats(statsRes.stats);
            setPosts(feedRes.feed.map(feedPostToLegacyPost));
            setIsFollowing(false);
          }
          return;
        }

        const token = authEnabled && isSignedIn ? await getToken() : null;
        const [profileRes, feedRes, statsRes] = await Promise.all([
          fetchProfile(handle),
          fetchProfileFeed(handle),
          fetchProfileStats(handle),
        ]);
        let following = false;
        if (token) {
          try {
            const followRes = await fetchFollowStatus(token, handle);
            following = followRes.following;
          } catch {
            // ignore — treat as not following
          }
        }
        if (!cancelled) {
          setProfile(profileRes.profile);
          setStats(statsRes.stats);
          setPosts(feedRes.feed.map(feedPostToLegacyPost));
          setIsFollowing(following);
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
  }, [authEnabled, handle, isSignedIn, ownProfile, reloadKey]);

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
        nextPosts = feedRes.feed.map(feedPostToLegacyPost);
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

  const toggleFollow = async () => {
    if (!profile || followBusy) return;

    setFollowError(null);

    if (!authEnabled || !isSignedIn) {
      setFollowError(authEnabled ? 'Sign in to follow profiles.' : 'Sign-in is not configured for this environment.');
      return;
    }

    setFollowBusy(true);
    const previousFollowing = isFollowing;
    const nextFollowing = !isFollowing;
    setIsFollowing(nextFollowing);

    try {
      const token = await getToken();
      if (!token) throw new Error('Sign in again to follow profiles.');

      try {
        await fetchMyProfile(token);
      } catch {
        throw new Error('Create your profile before following people.');
      }

      await (nextFollowing ? followProfile(token, profile.handle) : unfollowProfile(token, profile.handle));
    } catch (err) {
      setIsFollowing(previousFollowing);
      setFollowError(err instanceof Error ? err.message : 'Unable to update follow state.');
    } finally {
      setFollowBusy(false);
    }
  };

  const handleLike = (id: string, liked: boolean, token: string) => {
    setPosts((currentPosts) =>
      currentPosts.map((post) =>
        post.id === id
          ? {
              ...post,
              liked,
              like_count: Math.max(0, post.like_count + (liked ? 1 : -1)),
            }
          : post,
      ),
    );
    void (liked ? likePost(id, token) : unlikePost(id, token));
  };

  const handleRepost = (id: string, reposted: boolean, token: string) => {
    setPosts((currentPosts) =>
      currentPosts.map((post) =>
        post.id === id
          ? {
              ...post,
              reposted,
              repost_count: Math.max(0, post.repost_count + (reposted ? 1 : -1)),
            }
          : post,
      ),
    );
    void repostPost(id, token);
  };

  const handleBookmark = (id: string, bookmarked: boolean, token: string) => {
    setPosts((currentPosts) =>
      currentPosts.map((post) => (post.id === id ? { ...post, bookmarked } : post)),
    );
    void (bookmarked ? bookmarkPost(id, token) : unbookmarkPost(id, token));
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
      <div className="sticky top-[var(--top-bar-height)] z-10 flex items-center gap-6 border-b bg-black/80 px-4 py-3 backdrop-blur-md lg:top-0" style={{ borderColor: 'var(--border-primary)' }}>
        <button type="button" onClick={() => navigate(-1)} className="rounded-full p-2 transition-colors hover:bg-white/10" aria-label="Back">
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
          <img
            src={profile.avatarUrl ?? ''}
            alt={profile.displayName}
            className="h-[134px] w-[134px] rounded-full border-4 border-black object-cover"
            style={{ backgroundColor: 'var(--border-primary)' }}
          />
        </div>

        <div className="absolute bottom-3 right-4">
          <button
            type="button"
            onClick={ownProfile ? () => setEditOpen(true) : toggleFollow}
            disabled={!ownProfile && followBusy}
            className="rounded-full px-4 py-1.5 text-[14px] font-bold transition-colors hover:opacity-90"
            style={{
              border: ownProfile || isFollowing ? '1px solid var(--border-primary)' : undefined,
              backgroundColor: ownProfile || isFollowing ? 'transparent' : 'var(--accent)',
              color: ownProfile || isFollowing ? 'var(--text-primary)' : '#000',
            }}
          >
            {ownProfile ? 'Edit profile' : followBusy ? 'Saving' : isFollowing ? 'Following' : 'Follow'}
          </button>
        </div>
      </div>

      <section className="mt-20 px-4 pb-4">
        <h2 className="text-[23px] font-bold leading-tight">
          {profile.displayName}
        </h2>
        <p className="text-[15px]" style={{ color: 'var(--text-secondary)' }}>@{profile.handle}</p>

        <p className="mt-3 whitespace-pre-wrap text-[15px] leading-relaxed">{profile.bio}</p>

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
          <button type="button" className="flex gap-1 text-[15px] transition-colors hover:underline">
            <span className="font-bold">{formatCount(stats?.followingCount ?? 0)}</span>
            <span style={{ color: 'var(--text-secondary)' }}>Following</span>
          </button>
          <button type="button" className="flex gap-1 text-[15px] transition-colors hover:underline">
            <span className="font-bold">{formatCount(stats?.followerCount ?? 0)}</span>
            <span style={{ color: 'var(--text-secondary)' }}>Followers</span>
          </button>
        </div>
        {followError && (
          <p className="mt-3 text-[14px]" style={{ color: 'var(--color-danger)' }}>
            {followError}
          </p>
        )}
      </section>

      <div className="flex border-b" style={{ borderColor: 'var(--border-primary)' }}>
        {TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className="flex-1 py-4 text-[15px] font-medium transition-colors hover:bg-white/5"
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
          />
        ))
      )}

      {ownProfile && editOpen && (
        <EditProfileModal
          profile={profile}
          saving={savingEdit}
          error={editError}
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
      <div className="sticky top-[var(--top-bar-height)] z-10 border-b bg-black/80 px-4 py-3 backdrop-blur-md lg:top-0" style={{ borderColor: 'var(--border-primary)' }}>
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
      <div className="sticky top-[var(--top-bar-height)] z-10 border-b bg-black/80 px-4 py-3 backdrop-blur-md lg:top-0" style={{ borderColor: 'var(--border-primary)' }}>
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

function EditProfileModal({ profile, saving, error, onClose, onSubmit }: EditProfileModalProps) {
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [bio, setBio] = useState(profile.bio);
  const [location, setLocation] = useState(profile.location ?? '');
  const [website, setWebsite] = useState(profile.websiteUrl ?? '');
  const [avatarUrl, setAvatarUrl] = useState(profile.avatarUrl ?? '');
  const [bannerUrl, setBannerUrl] = useState(profile.bannerUrl ?? '');

  const cleanDisplayName = displayName.trim();
  const canSave = cleanDisplayName.length > 0 && !saving;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-10 sm:pt-16"
      style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
      onClick={onClose}
    >
      <form
        className="w-full max-w-[600px] overflow-hidden rounded-2xl border"
        style={{ backgroundColor: 'var(--bg-primary)', borderColor: 'var(--border-primary)' }}
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          if (!canSave) return;
          onSubmit({
            displayName: cleanDisplayName,
            bio: bio.trim(),
            location: location.trim() || undefined,
            websiteUrl: website.trim() || undefined,
            avatarUrl: avatarUrl.trim() || undefined,
            bannerUrl: bannerUrl.trim() || undefined,
          });
        }}
      >
        <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: 'var(--border-primary)' }}>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-full p-2 transition-colors hover:bg-white/10"
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
            {saving ? 'Saving' : 'Save'}
          </button>
        </div>

        <div className="max-h-[calc(100vh-140px)] overflow-y-auto px-4 py-5">
          <div className="grid gap-4">
            <ProfileEditField
              label="Display name"
              value={displayName}
              onChange={setDisplayName}
              maxLength={80}
              required
              disabled={saving}
            />
            <label className="block">
              <span className="mb-1 block text-[13px]" style={{ color: 'var(--text-secondary)' }}>Bio</span>
              <textarea
                value={bio}
                onChange={(event) => setBio(event.target.value)}
                className="min-h-24 w-full resize-none rounded-md border bg-transparent px-3 py-2 text-[15px] leading-relaxed outline-none focus:border-[var(--accent)]"
                style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-elevated)', color: 'var(--text-primary)' }}
                maxLength={280}
                disabled={saving}
              />
            </label>
            <ProfileEditField label="Location" value={location} onChange={setLocation} maxLength={80} disabled={saving} />
            <ProfileEditField label="Website" value={website} onChange={setWebsite} maxLength={120} disabled={saving} />
            <ProfileEditField label="Avatar URL" value={avatarUrl} onChange={setAvatarUrl} maxLength={500} disabled={saving} />
            <ProfileEditField label="Banner URL" value={bannerUrl} onChange={setBannerUrl} maxLength={500} disabled={saving} />
          </div>

          {error && <p className="mt-3 text-[13px]" style={{ color: 'var(--color-danger)' }}>{error}</p>}
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
