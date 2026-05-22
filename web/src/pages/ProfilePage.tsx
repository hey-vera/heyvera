import { useEffect, useState } from 'react';
import { ArrowLeft, CalendarDays, Link as LinkIcon, MapPin } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  bookmarkPost,
  followUser,
  getProfilePosts,
  getUserProfile,
  likePost,
  repostPost,
  unfollowUser,
  unlikePost,
} from '../api/client';
import type { Post, UserProfile } from '../api/types';
import { EmptyState, ErrorState, LoadingState } from '../components/shared/AsyncStates';
import { PostCard } from '../components/shared/PostCard';

const TABS = ['Posts', 'Replies', 'Media', 'Likes'] as const;
type Tab = typeof TABS[number];

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
  const profileHandle = handle ?? 'vera';
  const [activeTab, setActiveTab] = useState<Tab>('Posts');
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isFollowing, setIsFollowing] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function loadProfile() {
      setLoading(true);
      setError(null);
      try {
        const [nextProfile, feed] = await Promise.all([
          getUserProfile(profileHandle),
          getProfilePosts(profileHandle),
        ]);
        if (!cancelled) {
          setProfile(nextProfile);
          setPosts(feed.posts);
          setIsFollowing(nextProfile.is_following);
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
  }, [profileHandle, reloadKey]);

  const toggleFollow = () => {
    if (!profile) return;
    const nextFollowing = !isFollowing;
    setIsFollowing(nextFollowing);
    void (nextFollowing ? followUser(profile.id) : unfollowUser(profile.id));
  };

  if (loading) {
    return <LoadingState label="Loading profile" />;
  }

  if (error || !profile) {
    return <ErrorState detail={error ?? 'Profile unavailable'} onRetry={() => setReloadKey((key) => key + 1)} />;
  }

  const ownProfile = !handle;
  const visiblePosts = activeTab === 'Posts' ? posts : [];

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
      <div className="sticky top-0 z-10 flex items-center gap-6 border-b bg-black/80 px-4 py-3 backdrop-blur-md" style={{ borderColor: 'var(--border-primary)' }}>
        <button type="button" onClick={() => navigate(-1)} className="rounded-full p-2 transition-colors hover:bg-white/10" aria-label="Back">
          <ArrowLeft className="h-5 w-5" aria-hidden="true" />
        </button>
        <div>
          <h1 className="text-[20px] font-bold leading-tight">{profile.display_name}</h1>
          <p className="text-[13px]" style={{ color: 'var(--text-secondary)' }}>{profile.post_count} posts</p>
        </div>
      </div>

      <div className="relative">
        {profile.banner_url ? (
          <img src={profile.banner_url} alt="" className="h-[200px] w-full object-cover" />
        ) : (
          <div className="h-[200px] w-full" style={{ backgroundColor: 'var(--border-primary)' }} />
        )}

        <div className="absolute -bottom-16 left-4">
          <img
            src={profile.avatar_url}
            alt={profile.display_name}
            className="h-[134px] w-[134px] rounded-full border-4 border-black object-cover"
            style={{ backgroundColor: 'var(--border-primary)' }}
          />
        </div>

        <div className="absolute bottom-3 right-4">
          <button
            type="button"
            onClick={ownProfile ? undefined : toggleFollow}
            className="rounded-full px-4 py-1.5 text-[14px] font-bold transition-colors hover:opacity-90"
            style={{
              border: ownProfile || isFollowing ? '1px solid var(--border-primary)' : undefined,
              backgroundColor: ownProfile || isFollowing ? 'transparent' : 'var(--accent)',
              color: ownProfile || isFollowing ? 'var(--text-primary)' : '#000',
            }}
          >
            {ownProfile ? 'Edit profile' : isFollowing ? 'Following' : 'Follow'}
          </button>
        </div>
      </div>

      <section className="mt-20 px-4 pb-4">
        <h2 className="text-[23px] font-bold leading-tight">
          {profile.display_name}
          {profile.verified && <span className="ml-1 text-[15px]" style={{ color: 'var(--accent)' }}>✓</span>}
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
          {profile.website && (
            <a href={profile.website} className="flex items-center gap-1 hover:underline" style={{ color: 'var(--accent)' }}>
              <LinkIcon className="h-4 w-4" aria-hidden="true" />
              {profile.website.replace(/^https?:\/\//, '')}
            </a>
          )}
          <span className="flex items-center gap-1">
            <CalendarDays className="h-4 w-4" aria-hidden="true" />
            Joined {formatJoinedDate(profile.joined_at)}
          </span>
        </div>

        <div className="mt-3 flex gap-5">
          <button type="button" className="flex gap-1 text-[15px] transition-colors hover:underline">
            <span className="font-bold">{formatCount(profile.following_count)}</span>
            <span style={{ color: 'var(--text-secondary)' }}>Following</span>
          </button>
          <button type="button" className="flex gap-1 text-[15px] transition-colors hover:underline">
            <span className="font-bold">{formatCount(profile.follower_count)}</span>
            <span style={{ color: 'var(--text-secondary)' }}>Followers</span>
          </button>
        </div>
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
        <EmptyState title={activeTab === 'Posts' ? 'No posts yet' : 'Nothing here yet'} />
      ) : (
        visiblePosts.map((post) => (
          <PostCard
            key={post.id}
            post={post}
            onLike={(id, liked) => void (liked ? likePost(id) : unlikePost(id))}
            onRepost={(id) => void repostPost(id)}
            onBookmark={(id) => void bookmarkPost(id)}
          />
        ))
      )}
    </div>
  );
}

export default ProfilePage;
