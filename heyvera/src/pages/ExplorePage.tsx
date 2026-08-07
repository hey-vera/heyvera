import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Search } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router';
import {
  bookmarkPost,
  feedPostToPost,
  fetchTrending,
  likePost,
  repostPost,
  searchSocial,
  unbookmarkPost,
  unlikePost,
  unrepostPost,
} from '../api/social';
import type { Post } from '../api/types';
import { EmptyState, ErrorState, LoadingState } from '../components/shared/AsyncStates';
import { PostCard } from '../components/shared/PostCard';
import { useAuth } from '../hooks/useAuth';

/** Real filters that map to search type or a query seed — no decorative dead tabs. */
const FILTERS = [
  { id: 'all', label: 'All', searchType: 'all' as const, querySeed: null as string | null },
  { id: 'people', label: 'People', searchType: 'profiles' as const, querySeed: null },
  { id: 'posts', label: 'Posts', searchType: 'posts' as const, querySeed: null },
  { id: 'trending', label: 'Trending', searchType: 'all' as const, querySeed: null },
] as const;
type FilterId = (typeof FILTERS)[number]['id'];

type TrendingItem = { tag: string; postCount: number };
type ProfileItem = { id: string; handle: string; displayName: string; avatarUrl: string | null; bio: string };

interface SearchState {
  posts: Post[];
  profiles: ProfileItem[];
}

function formatCount(count: number): string {
  if (count < 1000) return `${count} posts`;
  return `${(count / 1000).toFixed(count < 10000 ? 1 : 0).replace(/\.0$/, '')}K posts`;
}

const EMPTY_SEARCH_RESULTS: SearchState = {
  posts: [],
  profiles: [],
};

export function ExplorePage() {
  const { authEnabled, isSignedIn, getToken } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialQuery = searchParams.get('q') ?? '';
  const initialFilter = (searchParams.get('filter') as FilterId | null) ?? 'all';
  const [activeFilter, setActiveFilter] = useState<FilterId>(
    FILTERS.some((f) => f.id === initialFilter) ? initialFilter : 'all',
  );
  const [query, setQuery] = useState(initialQuery);
  const [debouncedQuery, setDebouncedQuery] = useState(initialQuery);
  const [trending, setTrending] = useState<TrendingItem[]>([]);
  const [searchResults, setSearchResults] = useState<SearchState>(EMPTY_SEARCH_RESULTS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const trimmedQuery = debouncedQuery.trim();
  const isSearching = trimmedQuery.length > 0;
  const filterMeta = FILTERS.find((f) => f.id === activeFilter) ?? FILTERS[0];

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedQuery(query);
      const next: Record<string, string> = {};
      if (query.trim()) next.q = query.trim();
      if (activeFilter !== 'all') next.filter = activeFilter;
      setSearchParams(next, { replace: true });
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, activeFilter, setSearchParams]);

  useEffect(() => {
    let cancelled = false;

    async function loadExplore() {
      setLoading(true);
      setError(null);
      try {
        // Trending filter always loads trends when there is no query.
        if (!trimmedQuery || activeFilter === 'trending') {
          if (!trimmedQuery) {
            const result = await fetchTrending();
            if (!cancelled) {
              setTrending(result.topics);
              setSearchResults(EMPTY_SEARCH_RESULTS);
            }
            return;
          }
        }

        if (trimmedQuery) {
          const token = authEnabled && isSignedIn ? await getToken() : null;
          const result = await searchSocial(trimmedQuery, filterMeta.searchType, token);
          if (!cancelled) {
            setSearchResults({
              posts: result.posts.map(feedPostToPost),
              profiles: result.profiles,
            });
          }
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unable to load explore data');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadExplore();
    return () => {
      cancelled = true;
    };
  }, [authEnabled, getToken, isSignedIn, reloadKey, trimmedQuery, activeFilter, filterMeta.searchType]);

  const hasSearchResults =
    searchResults.posts.length > 0 ||
    searchResults.profiles.length > 0;

  const showTrends = !isSearching || activeFilter === 'trending';

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
      <div className="sticky top-[var(--top-bar-height)] z-10 px-4 py-3 backdrop-blur-md" style={{ backgroundColor: 'color-mix(in srgb, var(--bg-primary) 80%, transparent)' }}>
        <div className="relative">
          <Search className="absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2" style={{ color: 'var(--text-secondary)' }} aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search HeyVera"
            className="w-full rounded-full border py-3 pl-11 pr-4 text-[15px] outline-none transition-colors focus:border-[var(--accent)]"
            style={{
              borderColor: 'var(--border-primary)',
              backgroundColor: 'var(--bg-elevated)',
              color: 'var(--text-primary)',
            }}
          />
        </div>
      </div>

      <div className="flex overflow-x-auto border-b" style={{ borderColor: 'var(--border-primary)' }}>
        {FILTERS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveFilter(tab.id)}
            className="flex-shrink-0 px-5 py-4 text-[15px] font-medium transition-colors hover:bg-[color:color-mix(in_srgb,var(--text-primary)_5%,transparent)]"
            style={{ color: activeFilter === tab.id ? 'var(--text-primary)' : 'var(--text-secondary)' }}
          >
            <span className="relative inline-block">
              {tab.label}
              {activeFilter === tab.id && (
                <span className="absolute -bottom-[17px] left-0 right-0 h-[4px] rounded-full" style={{ backgroundColor: 'var(--accent)' }} />
              )}
            </span>
          </button>
        ))}
      </div>

      {loading && <LoadingState label={isSearching ? 'Searching' : 'Loading trends'} />}
      {!loading && error && (
        <ErrorState
          title="Search unavailable"
          detail={error}
          onRetry={() => setReloadKey((key) => key + 1)}
        />
      )}

      {!loading && !error && showTrends && !isSearching && (
        <section className="mx-4 mt-4 overflow-hidden rounded-2xl border" style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-elevated)' }}>
          <h2 className="px-4 pb-2 pt-4 text-[20px] font-bold">Trending</h2>
          {trending.length === 0 && <EmptyState title="No trends yet" />}
          {trending.map((item, index) => {
            const tagLabel = item.tag.startsWith('#') ? item.tag : `#${item.tag}`;
            return (
            <button
              key={item.tag}
              type="button"
              className="w-full px-4 py-3 text-left transition-colors hover:bg-[color:color-mix(in_srgb,var(--text-primary)_5%,transparent)]"
              style={{ borderBottom: index < trending.length - 1 ? '1px solid var(--border-primary)' : undefined }}
              onClick={() => {
                // Filter posts by hashtag query (honest search, not a fake tag index).
                setActiveFilter('posts');
                setQuery(tagLabel);
              }}
            >
              <p className="mb-0.5 text-[13px]" style={{ color: 'var(--text-secondary)' }}>Trending</p>
              <p className="text-[15px] font-bold leading-tight">{tagLabel}</p>
              <p className="mt-0.5 text-[13px]" style={{ color: 'var(--text-secondary)' }}>{formatCount(item.postCount)}</p>
            </button>
            );
          })}
        </section>
      )}

      {!loading && !error && isSearching && !hasSearchResults && (
        <EmptyState title="No results" detail={`No posts or people matched "${trimmedQuery}".`} />
      )}

      {!loading && !error && isSearching && hasSearchResults && (
        <div>
          {searchResults.profiles.length > 0 && filterMeta.searchType !== 'posts' && (
            <SearchSection title="People">
              {searchResults.profiles.map((profile, index) => (
                <UserRow key={profile.id} user={profile} showBorder={index < searchResults.profiles.length - 1} onNavigate={(handle) => navigate(`/profile/${handle}`)} />
              ))}
            </SearchSection>
          )}

          {searchResults.posts.length > 0 && filterMeta.searchType !== 'profiles' && (
            <section className="border-t" style={{ borderColor: 'var(--border-primary)' }}>
              <h2 className="px-4 pb-2 pt-4 text-[20px] font-bold">Posts</h2>
              {searchResults.posts.map((post) => (
                <PostCard
                  key={post.id}
                  post={post}
                  onLike={(id, liked, token) => (liked ? likePost(token, id) : unlikePost(token, id))}
                  onRepost={(id, reposted, token) => (reposted ? repostPost : unrepostPost)(token, id)}
                  onBookmark={(id, bookmarked, token) =>
                    bookmarked ? bookmarkPost(token, id) : unbookmarkPost(token, id)
                  }
                  onDelete={(id) => {
                    setSearchResults((current) =>
                      current
                        ? {
                            ...current,
                            posts: current.posts.filter((p) => p.id !== id),
                          }
                        : current,
                    );
                  }}
                />
              ))}
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function SearchSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t" style={{ borderColor: 'var(--border-primary)' }}>
      <h2 className="px-4 pb-2 pt-4 text-[20px] font-bold">{title}</h2>
      <div>{children}</div>
    </section>
  );
}

function UserRow({ user, showBorder, onNavigate }: { user: { id: string; handle: string; displayName: string; avatarUrl: string | null; bio: string }; showBorder: boolean; onNavigate: (handle: string) => void }) {
  return (
    <button
      type="button"
      className="flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-[color:color-mix(in_srgb,var(--text-primary)_3%,transparent)]"
      style={{ borderBottom: showBorder ? '1px solid var(--border-primary)' : undefined }}
      onClick={() => onNavigate(user.handle)}
    >
      {user.avatarUrl ? (
        <img
          src={user.avatarUrl}
          alt={user.displayName}
          className="h-10 w-10 shrink-0 rounded-full object-cover"
          style={{ backgroundColor: 'var(--border-primary)' }}
        />
      ) : (
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm"
          style={{ backgroundColor: 'var(--border-primary)', color: 'var(--text-secondary)' }}
        >
          {user.displayName.charAt(0)}
        </div>
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1 text-[15px] leading-5">
          <span className="truncate font-bold" style={{ color: 'var(--text-primary)' }}>{user.displayName}</span>
        </div>
        <p className="truncate text-[15px] leading-5" style={{ color: 'var(--text-secondary)' }}>@{user.handle}</p>
        {user.bio && (
          <p className="mt-0.5 line-clamp-2 text-[13px] leading-4" style={{ color: 'var(--text-secondary)' }}>{user.bio}</p>
        )}
      </div>
    </button>
  );
}

export default ExplorePage;
