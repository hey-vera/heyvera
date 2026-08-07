import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import type { FeedPost } from "../../api/social";
import type { ShellState } from "../../hooks/useShellState";

type BookmarksPageProps = {
  shellState: ShellState;
};

function getBookmarkIds(): string[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const stored = window.localStorage.getItem("heyvera-bookmarks");
    if (!stored) {
      return [];
    }

    const parsed = JSON.parse(stored) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((value): value is string => typeof value === "string");
  } catch {
    return [];
  }
}

async function fetchFeed(): Promise<FeedPost[]> {
  const response = await fetch("/v1/feed?limit=100");
  if (!response.ok) {
    throw new Error(`Failed to fetch feed: ${response.status}`);
  }

  const data = (await response.json()) as { feed?: FeedPost[] };
  return data.feed ?? [];
}

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);

  if (Number.isNaN(date.getTime())) {
    return timestamp;
  }

  return date.toLocaleString();
}

export function BookmarksPage({ shellState }: BookmarksPageProps) {
  const navigate = useNavigate();
  const [bookmarkIds, setBookmarkIds] = useState<string[]>(() => getBookmarkIds());
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setBookmarkIds(getBookmarkIds());
  }, [shellState]);

  useEffect(() => {
    let cancelled = false;

    async function loadBookmarks() {
      if (shellState !== "ready") {
        setPosts([]);
        setLoading(false);
        return;
      }

      if (bookmarkIds.length === 0) {
        setPosts([]);
        setLoading(false);
        return;
      }

      setLoading(true);

      try {
        const feed = await fetchFeed();
        if (cancelled) {
          return;
        }

        const bookmarkedPosts = bookmarkIds
          .map((id) => feed.find((post) => post.id === id) ?? null)
          .filter((post): post is FeedPost => post !== null);

        setPosts(bookmarkedPosts);
      } catch {
        if (!cancelled) {
          setPosts([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadBookmarks();

    return () => {
      cancelled = true;
    };
  }, [bookmarkIds, shellState]);

  function removeBookmark(postId: string) {
    const nextIds = bookmarkIds.filter((id) => id !== postId);
    window.localStorage.setItem("heyvera-bookmarks", JSON.stringify(nextIds));
    setBookmarkIds(nextIds);
    setPosts((current) => current.filter((post) => post.id !== postId));
  }

  function clearAllBookmarks() {
    window.localStorage.setItem("heyvera-bookmarks", JSON.stringify([]));
    setBookmarkIds([]);
    setPosts([]);
  }

  return (
    <section className="bookmarks-page">
      <header className="bookmarks-page-header">
        <h1 className="bookmarks-page-title">Bookmarks</h1>
        {shellState === "ready" && bookmarkIds.length > 0 ? (
          <button
            type="button"
            className="bookmarks-page-clear-button"
            onClick={clearAllBookmarks}
          >
            Clear all
          </button>
        ) : null}
      </header>

      {shellState !== "ready" ? (
        <div className="bookmarks-page-empty-state">
          <p className="bookmarks-page-empty-copy">Sign in to bookmark posts</p>
        </div>
      ) : loading ? (
        <div className="bookmarks-page-loading" aria-busy="true">
          <p className="bookmarks-page-loading-copy">Loading bookmarks...</p>
        </div>
      ) : bookmarkIds.length === 0 ? (
        <div className="bookmarks-page-empty-state">
          <p className="bookmarks-page-empty-copy">
            No bookmarks yet. Save posts to read later.
          </p>
        </div>
      ) : posts.length === 0 ? (
        <div className="bookmarks-page-empty-state">
          <p className="bookmarks-page-empty-copy">
            Saved bookmarks could not be found in the latest feed.
          </p>
        </div>
      ) : (
        <div className="bookmarks-page-list" aria-label="Bookmarked posts">
          {posts.map((post) => (
            <article
              key={post.id}
              className="bookmarks-post-card"
              onClick={() => navigate(`/post/${post.id}`)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  navigate(`/post/${post.id}`);
                }
              }}
              role="button"
              tabIndex={0}
            >
              <header className="bookmarks-post-card-header">
                <div className="bookmarks-post-card-author">
                  <strong className="bookmarks-post-card-display-name">
                    {post.author.displayName}
                  </strong>
                  <span className="bookmarks-post-card-handle">
                    @{post.author.handle}
                  </span>
                </div>
                <time
                  className="bookmarks-post-card-timestamp"
                  dateTime={post.createdAt}
                >
                  {formatTimestamp(post.createdAt)}
                </time>
              </header>

              <p className="bookmarks-post-card-body">{post.body}</p>

              <div className="bookmarks-post-card-actions">
                <button
                  type="button"
                  className="bookmarks-post-card-remove-button"
                  onClick={(event) => {
                    event.stopPropagation();
                    removeBookmark(post.id);
                  }}
                >
                  Remove bookmark
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
