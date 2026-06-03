import { useEffect, useMemo, useState } from 'react';
import { SignInButton } from '@clerk/clerk-react';
import { Bookmark, Search } from 'lucide-react';
import { bookmarkPost, feedPostToPost, fetchHomeFeed, likePost, repostPost, unbookmarkPost, unlikePost } from '../api/social';
import type { Post } from '../api/types';
import { EmptyState, ErrorState, LoadingState } from '../components/shared/AsyncStates';
import { PostCard } from '../components/shared/PostCard';
import { useAuth } from '../hooks/useAuth';

type BookmarkFolderId = 'all' | 'read-later' | 'agents' | 'protocol' | 'media';

interface BookmarkFolder {
  id: BookmarkFolderId;
  label: string;
}

const BOOKMARK_FOLDERS: BookmarkFolder[] = [
  { id: 'all', label: 'All' },
  { id: 'read-later', label: 'Read later' },
  { id: 'agents', label: 'Agents' },
  { id: 'protocol', label: 'Protocol' },
  { id: 'media', label: 'Media' },
];

function getPostFolder(post: Post): Exclude<BookmarkFolderId, 'all'> {
  const searchableText = [
    post.content,
    post.author.display_name,
    post.author.handle,
    post.media?.map((item) => [item.type, item.alt_text].filter(Boolean).join(' ')).join(' '),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (post.media?.length || /\b(image|video|gif|photo|screenshot|clip|demo)\b/.test(searchableText)) {
    return 'media';
  }

  if (/\b(soma|protocol|rfc|delegation|proof|token|genesis|credential|identity)\b/.test(searchableText)) {
    return 'protocol';
  }

  if (/\b(agent|agents|cortex|vera|assistant|automation|pipeline|runtime)\b/.test(searchableText)) {
    return 'agents';
  }

  return 'read-later';
}

function filterPostsByFolder(posts: Post[], folderId: BookmarkFolderId): Post[] {
  if (folderId === 'all') return posts;
  return posts.filter((post) => getPostFolder(post) === folderId);
}

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
  const { authEnabled, isSignedIn } = useAuth();
  const [posts, setPosts] = useState<Post[]>([]);
  const [query, setQuery] = useState('');
  const [activeFolder, setActiveFolder] = useState<BookmarkFolderId>('all');
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

        const response = await fetchHomeFeed(50);
        if (!cancelled) {
          setPosts(response.feed.map(feedPostToPost).filter((post) => post.bookmarked));
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
  }, [authEnabled, isSignedIn, reloadKey]);

  const folderCounts = useMemo(
    () =>
      BOOKMARK_FOLDERS.reduce<Record<BookmarkFolderId, number>>(
        (counts, folder) => ({
          ...counts,
          [folder.id]: filterPostsByFolder(posts, folder.id).length,
        }),
        { all: 0, 'read-later': 0, agents: 0, protocol: 0, media: 0 },
      ),
    [posts],
  );
  const folderedPosts = useMemo(() => filterPostsByFolder(posts, activeFolder), [activeFolder, posts]);
  const filteredPosts = useMemo(() => filterPostsByQuery(folderedPosts, query), [folderedPosts, query]);
  const activeFolderLabel = BOOKMARK_FOLDERS.find((folder) => folder.id === activeFolder)?.label ?? 'Bookmarks';
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

      <div
        className="border-b px-4"
        style={{ borderColor: 'var(--border-primary)' }}
        aria-label="Bookmark folders"
      >
        <div className="flex gap-2 overflow-x-auto py-3">
          {BOOKMARK_FOLDERS.map((folder) => {
            const selected = activeFolder === folder.id;

            return (
              <button
                key={folder.id}
                type="button"
                onClick={() => setActiveFolder(folder.id)}
                className="flex h-9 shrink-0 items-center gap-2 rounded-full border px-4 text-[15px] font-bold transition-colors"
                style={{
                  backgroundColor: selected ? 'var(--accent)' : 'var(--bg-elevated)',
                  borderColor: selected ? 'var(--accent)' : 'var(--border-primary)',
                  color: selected ? 'var(--bg-primary)' : 'var(--text-primary)',
                }}
                aria-pressed={selected}
              >
                <span>{folder.label}</span>
                <span
                  className="text-[13px] font-bold"
                  style={{ color: selected ? 'var(--bg-primary)' : 'var(--text-secondary)' }}
                >
                  {folderCounts[folder.id]}
                </span>
              </button>
            );
          })}
        </div>
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
          title={trimmedQuery ? 'No matching bookmarks' : `No ${activeFolderLabel.toLowerCase()} bookmarks`}
          detail={
            trimmedQuery
              ? `No saved posts in ${activeFolderLabel} match "${trimmedQuery}".`
              : `Saved posts assigned to ${activeFolderLabel} will appear here.`
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
