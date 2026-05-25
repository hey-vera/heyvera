import { useCallback, useEffect, useRef, useState } from 'react';
import { SignInButton } from '@clerk/clerk-react';
import {
  bookmarkPost,
  createPost,
  feedPostToPost,
  fetchHomeFeed,
  fetchMyProfile,
  likePost,
  repostPost,
  unbookmarkPost,
  unlikePost,
} from '../api/social';
import type { Post } from '../api/types';
import { LoadingState, EmptyState, ErrorState } from '../components/shared/AsyncStates';
import { PostCard } from '../components/shared/PostCard';
import { useAuth } from '../hooks/useAuth';

const TABS = ['For you', 'Following'] as const;
type Tab = typeof TABS[number];

const PULL_REFRESH_THRESHOLD = 72;
const FEED_PAGE_SIZE = 20;

/** Parsed feed result in the shape HomePage state expects. */
type FeedResult = {
  posts: Post[];
  nextCursor: number | null;
};

export function HomePage() {
  const { authEnabled, isSignedIn, getToken } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>('For you');
  const [posts, setPosts] = useState<Post[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [posting, setPosting] = useState(false);
  const [composeNotice, setComposeNotice] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [pendingFeed, setPendingFeed] = useState<FeedResult | null>(null);
  const [newPostCount, setNewPostCount] = useState(0);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const touchStartY = useRef<number | null>(null);

  const loadFeedPage = useCallback(async (offsetCursor = 0): Promise<FeedResult> => {
    const filter = activeTab === 'Following' ? 'following' : undefined;
    const response = await fetchHomeFeed(FEED_PAGE_SIZE, offsetCursor, filter);
    return {
      posts: response.feed.map(feedPostToPost),
      nextCursor: response.pageInfo.nextCursor != null ? Number(response.pageInfo.nextCursor) : null,
    };
  }, [activeTab]);

  useEffect(() => {
    let cancelled = false;

    async function loadFeed() {
      setLoading(true);
      setError(null);
      setPendingFeed(null);
      setNewPostCount(0);
      try {
        const response = await loadFeedPage();
        if (!cancelled) {
          setPosts(response.posts);
          setCursor(response.nextCursor);
          setHasMore(response.nextCursor !== null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unable to load feed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadFeed();
    return () => {
      cancelled = true;
    };
  }, [loadFeedPage, reloadKey]);

  const loadMorePosts = useCallback(async () => {
    if (loading || loadingMore || !hasMore || cursor === null) return;

    setLoadingMore(true);
    try {
      const response = await loadFeedPage(cursor);
      setPosts((current) => {
        const existingIds = new Set(current.map((post) => post.id));
        const nextPosts = response.posts.filter((post) => !existingIds.has(post.id));
        return [...current, ...nextPosts];
      });
      setCursor(response.nextCursor);
      setHasMore(response.nextCursor !== null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load more posts');
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, hasMore, loadFeedPage, loading, loadingMore]);

  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target) return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void loadMorePosts();
      },
      { rootMargin: '360px 0px' },
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [loadMorePosts]);

  const checkForNewPosts = useCallback(async () => {
    if (refreshing) return;

    setRefreshing(true);
    setError(null);
    try {
      const response = await loadFeedPage();
      const visibleIds = new Set(posts.map((post) => post.id));
      const unseenCount = response.posts.filter((post) => !visibleIds.has(post.id)).length;
      const simulatedCount = unseenCount || Math.min(response.posts.length, 3);

      setPendingFeed(response);
      setNewPostCount(simulatedCount);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to refresh feed');
    } finally {
      setRefreshing(false);
    }
  }, [loadFeedPage, posts, refreshing]);

  const showPendingPosts = () => {
    if (!pendingFeed) return;

    setPosts(pendingFeed.posts);
    setCursor(pendingFeed.nextCursor);
    setHasMore(pendingFeed.nextCursor !== null);
    setPendingFeed(null);
    setNewPostCount(0);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    if (window.scrollY > 0 || loading || refreshing) return;
    touchStartY.current = event.touches[0]?.clientY ?? null;
  };

  const handleTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    if (touchStartY.current === null) return;

    const currentY = event.touches[0]?.clientY;
    if (currentY === undefined) return;

    const distance = Math.max(0, currentY - touchStartY.current);
    setPullDistance(Math.min(distance, 96));
  };

  const handleTouchEnd = () => {
    const shouldRefresh = pullDistance >= PULL_REFRESH_THRESHOLD;
    touchStartY.current = null;
    setPullDistance(0);

    if (shouldRefresh) void checkForNewPosts();
  };

  const submitPost = async () => {
    const trimmed = content.trim();
    if (!trimmed || posting) return;

    setPosting(true);
    setComposeNotice(null);
    try {
      if (!authEnabled || !isSignedIn) {
        setComposeNotice(authEnabled ? 'Sign in to post.' : 'Sign-in is not configured for this environment.');
        return;
      }

      const token = await getToken();
      if (!token) {
        setComposeNotice('Sign in again to post.');
        return;
      }

      try {
        await fetchMyProfile(token);
      } catch (profileErr: unknown) {
        const msg = profileErr instanceof Error ? profileErr.message.toLowerCase() : '';
        if (msg.includes('404') || msg.includes('not found')) {
          setComposeNotice('Create your profile before posting.');
          return;
        }
        throw profileErr;
      }

      const result = await createPost(token, { body: trimmed });
      setPosts((current) => [feedPostToPost(result.post), ...current]);
      setContent('');
    } catch (err) {
      setComposeNotice(err instanceof Error ? err.message : 'Post failed. Try again.');
    } finally {
      setPosting(false);
    }
  };

  return (
    <div
      className="min-h-screen"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}
    >
      <div className="sticky top-[var(--top-bar-height)] z-10 flex border-b bg-black/80 backdrop-blur-md lg:top-0" style={{ borderColor: 'var(--border-primary)' }}>
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

      <div
        aria-hidden={pullDistance === 0 && !refreshing}
        className="overflow-hidden border-b text-center text-[13px] transition-[height] duration-150 sm:hidden"
        style={{
          borderColor: pullDistance > 0 || refreshing ? 'var(--border-primary)' : 'transparent',
          color: 'var(--text-secondary)',
          height: refreshing ? 36 : pullDistance > 0 ? Math.min(pullDistance, 36) : 0,
        }}
      >
        <div className="py-2">
          {refreshing ? 'Checking for new posts' : pullDistance >= PULL_REFRESH_THRESHOLD ? 'Release to refresh' : 'Pull to refresh'}
        </div>
      </div>

      <div className="border-b px-4 py-3" style={{ borderColor: 'var(--border-primary)' }}>
        <div className="flex gap-3">
          <div className="h-10 w-10 flex-shrink-0 rounded-full" style={{ backgroundColor: 'var(--border-primary)' }} />

          <div className="flex-1">
            <textarea
              value={content}
              onChange={(event) => setContent(event.target.value.slice(0, 280))}
              placeholder="What's happening?"
              rows={2}
              className="w-full resize-none bg-transparent text-[20px] leading-normal outline-none"
              style={{ color: 'var(--text-primary)' }}
            />

            <div className="mt-2 flex items-center justify-between border-t pt-2" style={{ borderColor: 'var(--border-primary)' }}>
              <span className="text-[13px]" style={{ color: content.length > 260 ? 'var(--color-danger)' : 'var(--text-secondary)' }}>
                {content.length}/280
              </span>

              <button
                type="button"
                onClick={submitPost}
                disabled={!content.trim() || posting}
                className="rounded-full px-4 py-1.5 text-[15px] font-bold transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                style={{ backgroundColor: 'var(--accent)', color: 'var(--bg-primary)' }}
              >
                {posting ? 'Posting' : 'Post'}
              </button>
            </div>
            {composeNotice && (
              <div className="mt-3 flex flex-wrap items-center gap-3 text-[13px]" style={{ color: 'var(--text-secondary)' }}>
                <span>{composeNotice}</span>
                {composeNotice === 'Sign in to post.' && authEnabled ? (
                  <SignInButton mode="modal">
                    <button
                      type="button"
                      className="rounded-full border px-3 py-1 text-[13px] font-bold transition-colors hover:bg-white/10"
                      style={{ borderColor: 'var(--border-secondary)', color: 'var(--text-primary)' }}
                    >
                      Sign in
                    </button>
                  </SignInButton>
                ) : composeNotice === 'Create your profile before posting.' ? (
                  <a
                    href="/profile"
                    className="rounded-full border px-3 py-1 text-[13px] font-bold transition-colors hover:bg-white/10"
                    style={{ borderColor: 'var(--border-secondary)', color: 'var(--text-primary)' }}
                  >
                    Go to profile
                  </a>
                ) : null}
              </div>
            )}
          </div>
        </div>
      </div>

      {pendingFeed && newPostCount > 0 && (
        <button
          type="button"
          onClick={showPendingPosts}
          className="sticky top-[calc(var(--top-bar-height)+53px)] z-[9] w-full border-b py-3 text-[15px] font-bold transition-colors hover:bg-white/5 lg:top-0"
          style={{
            backgroundColor: 'var(--bg-primary)',
            borderColor: 'var(--border-primary)',
            color: 'var(--accent)',
          }}
        >
          Show {newPostCount} new {newPostCount === 1 ? 'post' : 'posts'}
        </button>
      )}

      {loading && <LoadingState label="Loading feed" />}
      {!loading && error && <ErrorState detail={error} onRetry={() => setReloadKey((key) => key + 1)} />}
      {!loading && !error && posts.length === 0 && (
        <EmptyState title="No posts yet" detail="When there is activity in this feed, it will appear here." />
      )}
      {!loading && !error && posts.map((post) => (
        <PostCard
          key={post.id}
          post={post}
          onLike={(id, liked, token) => void (liked ? likePost(token, id) : unlikePost(token, id))}
          onRepost={(id, _reposted, token) => void repostPost(token, id)}
          onBookmark={(id, bookmarked, token) => void (bookmarked ? bookmarkPost(token, id) : unbookmarkPost(token, id))}
        />
      ))}
      {!loading && !error && (
        <div ref={loadMoreRef} className="min-h-12">
          {loadingMore && <LoadingState label="Loading more posts" />}
          {!loadingMore && hasMore && cursor === null && (
            <div className="px-4 py-6 text-center text-[13px]" style={{ color: 'var(--text-secondary)' }}>
              More posts will load when the feed returns a cursor.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default HomePage;
