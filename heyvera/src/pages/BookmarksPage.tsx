import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SignInButton } from '@clerk/clerk-react';
import { Bookmark, Search } from 'lucide-react';
import {
  bookmarkPost,
  feedPostToPost,
  fetchBookmarks,
  likePost,
  repostPost,
  unbookmarkPost,
  unlikePost,
  unrepostPost,
} from '../api/social';
import type { Post } from '../api/types';
import { EmptyState, ErrorState, LoadingState } from '../components/shared/AsyncStates';
import { PostCard } from '../components/shared/PostCard';
import { useAuth } from '../hooks/useAuth';
import {
  mapBookmarkInPosts,
  mapLikeInPosts,
  mapRepostInPosts,
  withOptimisticPostMutation,
} from '../utils/optimisticPostMutation';

const PAGE_SIZE = 50;

function filterPostsByQuery(posts: Post[], query: string): Post[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return posts;

  return posts.filter((post) => {
    const searchableText = [
      post.content,
      post.author.display_name,
      post.author.handle,
    ].join(' ').toLowerCase();

    return searchableText.includes(normalizedQuery);
  });
}

function appendUniquePosts(current: Post[], incoming: Post[]): Post[] {
  const existingIds = new Set(current.map((post) => post.id));
  const next = incoming.filter((post) => !existingIds.has(post.id));
  return next.length === 0 ? current : [...current, ...next];
}

function networkishErrorMessage(err: unknown, fallback: string): string {
  const msg = err instanceof Error ? err.message : '';
  if (/failed to fetch|networkerror|network request failed|load failed|fetch failed/i.test(msg)) {
    return 'Unable to reach the server. Check your connection and try again.';
  }
  return msg || fallback;
}

export function BookmarksPage() {
  const { authEnabled, isSignedIn, getToken } = useAuth();
  const [posts, setPosts] = useState<Post[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Soft failure while bookmarks remain visible (load-more only). */
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadBookmarks() {
      setLoading(true);
      setError(null);
      setLoadMoreError(null);
      setCursor(null);
      setHasMore(false);

      try {
        if (authEnabled && !isSignedIn) {
          if (!cancelled) setPosts([]);
          return;
        }

        const token = authEnabled ? await getToken() : null;
        if (!token) {
          if (!cancelled) setPosts([]);
          return;
        }

        const response = await fetchBookmarks(token, PAGE_SIZE);
        if (!cancelled) {
          setPosts(response.posts.map(feedPostToPost));
          setCursor(response.cursor);
          setHasMore(response.has_more && response.cursor != null);
        }
      } catch (err) {
        if (!cancelled) {
          setPosts([]);
          setCursor(null);
          setHasMore(false);
          setError(networkishErrorMessage(err, 'Unable to load bookmarks'));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadBookmarks();

    return () => {
      cancelled = true;
    };
  }, [authEnabled, isSignedIn, getToken, reloadKey]);

  const loadMoreBookmarks = useCallback(async () => {
    if (loading || loadingMore || !hasMore || cursor == null || error) return;

    setLoadingMore(true);
    setLoadMoreError(null);
    try {
      const token = await getToken();
      if (!token) {
        setLoadMoreError('Unable to verify your session. Sign in again to load more.');
        return;
      }
      const response = await fetchBookmarks(token, PAGE_SIZE, cursor);
      setPosts((current) => appendUniquePosts(current, response.posts.map(feedPostToPost)));
      setCursor(response.cursor);
      setHasMore(response.has_more && response.cursor != null);
    } catch (err) {
      // Keep existing list; surface a soft error under the list.
      setLoadMoreError(networkishErrorMessage(err, 'Unable to load more bookmarks'));
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, error, getToken, hasMore, loading, loadingMore]);

  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target) return undefined;
    // After a soft failure, stop IntersectionObserver spam until the user retries.
    if (loadMoreError) return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void loadMoreBookmarks();
      },
      { rootMargin: '360px 0px' },
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [loadMoreBookmarks, loadMoreError]);

  const filteredPosts = useMemo(() => filterPostsByQuery(posts, query), [posts, query]);
  const trimmedQuery = query.trim();

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
          // Unbookmark removes the row from this list; restore snapshot on failure.
          return bookmarked
            ? mapBookmarkInPosts(current, id, true)
            : current.filter((post) => post.id !== id);
        });
      },
      mutate: () => (bookmarked ? bookmarkPost(token, id) : unbookmarkPost(token, id)),
      revert: () => {
        if (snapshot) setPosts(snapshot);
      },
    });
  };

  return (
    <div
      className="min-h-screen"
      style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}
    >
      <div
        className="sticky top-[var(--top-bar-height)] z-10 border-b px-4 py-3 backdrop-blur-md"
        style={{
          backgroundColor: 'color-mix(in srgb, var(--bg-primary) 80%, transparent)',
          borderColor: 'var(--border-primary)',
        }}
      >
        <div className="flex items-center gap-3">
          <Bookmark className="h-5 w-5 shrink-0" aria-hidden="true" style={{ color: 'var(--accent)' }} />
          <div className="min-w-0">
            <h1 className="text-[20px] font-bold leading-6">Bookmarks</h1>
            <p className="text-[13px]" style={{ color: 'var(--text-secondary)' }}>
              Posts saved for later
            </p>
          </div>
        </div>
      </div>

      <div className="border-b px-4 py-3" style={{ borderColor: 'var(--border-primary)' }}>
        <label className="relative block">
          <span className="sr-only">Search bookmarks</span>
          <Search
            className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2"
            aria-hidden="true"
            style={{ color: 'var(--text-secondary)' }}
          />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search bookmarks"
            className="w-full rounded-full border py-2.5 pl-10 pr-4 text-[15px] outline-none transition-colors placeholder:text-[color:var(--text-secondary)] focus:border-[color:var(--accent)]"
            style={{
              backgroundColor: 'var(--bg-elevated)',
              borderColor: 'var(--border-primary)',
              color: 'var(--text-primary)',
            }}
          />
        </label>
      </div>

      {loading && <LoadingState label="Loading bookmarks" />}

      {!loading && authEnabled && !isSignedIn && <SignedOutBookmarksPrompt />}

      {!loading && error && (
        <ErrorState
          detail={error}
          onRetry={() => setReloadKey((key) => key + 1)}
        />
      )}

      {!loading && !(authEnabled && !isSignedIn) && !error && posts.length === 0 && (
        <EmptyState
          title="Save posts for later"
          detail="When you bookmark posts, they will appear here."
        />
      )}

      {!loading && !(authEnabled && !isSignedIn) && !error && posts.length > 0 && filteredPosts.length === 0 && (
        <EmptyState
          title="No matching bookmarks"
          detail={
            trimmedQuery
              ? `No saved posts match "${trimmedQuery}".`
              : 'No bookmarks match your search.'
          }
        />
      )}

      {!loading && !(authEnabled && !isSignedIn) && !error && filteredPosts.map((post) => (
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
      ))}

      {!loading && !(authEnabled && !isSignedIn) && !error && posts.length > 0 && (
        <div ref={loadMoreRef} className="min-h-12">
          {loadingMore && <LoadingState label="Loading more bookmarks" />}
          {!loadingMore && loadMoreError && (
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3"
              style={{ borderColor: 'var(--border-primary)' }}
            >
              <p className="text-[13px]" style={{ color: 'var(--text-secondary)' }}>
                {loadMoreError}
              </p>
              <button
                type="button"
                onClick={() => void loadMoreBookmarks()}
                className="shrink-0 rounded-full border px-3 py-1.5 text-[13px] font-semibold transition-opacity hover:opacity-80"
                style={{ borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}
              >
                Retry
              </button>
            </div>
          )}
          {!loadingMore && !loadMoreError && hasMore && cursor != null && (
            <div className="px-4 py-4 text-center">
              <button
                type="button"
                onClick={() => void loadMoreBookmarks()}
                className="rounded-full border px-4 py-2 text-[13px] font-semibold transition-opacity hover:opacity-80"
                style={{ borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}
              >
                Load more
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SignedOutBookmarksPrompt() {
  return (
    <div className="px-4 py-10">
      <div className="mx-auto max-w-sm text-center">
        <h2 className="text-[20px] font-bold">Sign in to see bookmarks</h2>
        <p className="mt-2 text-[15px]" style={{ color: 'var(--text-secondary)' }}>
          Saved posts are private to your account.
        </p>
        <SignInButton mode="modal">
          <button
            type="button"
            className="mt-5 rounded-full px-5 py-2 text-[15px] font-bold"
            style={{ backgroundColor: 'var(--accent)', color: 'var(--bg-primary)' }}
          >
            Sign in
          </button>
        </SignInButton>
      </div>
    </div>
  );
}

export default BookmarksPage;
