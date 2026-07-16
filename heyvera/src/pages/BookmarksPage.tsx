import { useEffect, useMemo, useState } from 'react';
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
} from '../api/social';
import type { Post } from '../api/types';
import { EmptyState, ErrorState, LoadingState } from '../components/shared/AsyncStates';
import { PostCard } from '../components/shared/PostCard';
import { useAuth } from '../hooks/useAuth';

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

export function BookmarksPage() {
  const { authEnabled, isSignedIn, getToken } = useAuth();
  const [posts, setPosts] = useState<Post[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function loadBookmarks() {
      setLoading(true);
      setError(null);

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

        const response = await fetchBookmarks(token, 50);
        if (!cancelled) {
          setPosts(response.posts.map(feedPostToPost));
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unable to load bookmarks');
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

  const filteredPosts = useMemo(() => filterPostsByQuery(posts, query), [posts, query]);
  const trimmedQuery = query.trim();

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
    void (liked ? likePost(token, id) : unlikePost(token, id));
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
    void repostPost(token, id);
  };

  const handleBookmark = (id: string, bookmarked: boolean, token: string) => {
    setPosts((currentPosts) =>
      bookmarked
        ? currentPosts.map((post) => (post.id === id ? { ...post, bookmarked } : post))
        : currentPosts.filter((post) => post.id !== id),
    );
    void (bookmarked ? bookmarkPost(token, id) : unbookmarkPost(token, id));
  };

  return (
    <div
      className="min-h-screen"
      style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}
    >
      <div
        className="sticky top-[var(--top-bar-height)] z-10 border-b px-4 py-3 backdrop-blur-md lg:top-0"
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
        />
      ))}
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
