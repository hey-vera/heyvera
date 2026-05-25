import { useEffect, useState, type ReactNode } from 'react';
import { Search } from 'lucide-react';
import {
  bookmarkPost,
  feedPostToPost,
  fetchTrending,
  likePost,
  repostPost,
  searchSocial,
  unbookmarkPost,
  unlikePost,
} from '../api/social';
import type { Post } from '../api/types';
import { EmptyState, ErrorState, LoadingState } from '../components/shared/AsyncStates';
import { PostCard } from '../components/shared/PostCard';
import { useAuth } from '../hooks/useAuth';

const TABS = ['For you', 'Trending', 'News', 'Tech', 'AI'] as const;
type Tab = typeof TABS[number];

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
  const { authEnabled, isSignedIn } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>('For you');
  const [query, setQuery] = useState('');
  const [trending, setTrending] = useState<TrendingItem[]>([]);
  const [searchResults, setSearchResults] = useState<SearchState>(EMPTY_SEARCH_RESULTS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const trimmedQuery = query.trim();
  const isSearching = trimmedQuery.length > 0;

  useEffect(() => {
    let cancelled = false;

    async function loadExplore() {
      setLoading(true);
      setError(null);
      try {
        if (trimmedQuery) {
          const result = await searchSocial(trimmedQuery);
          if (!cancelled) {
            setSearchResults({
              posts: result.posts.map(feedPostToPost),
              profiles: result.profiles,
            });
          }
        } else {
          const result = await fetchTrending();
          if (!cancelled) setTrending(result.topics);
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
  }, [authEnabled, isSignedIn, reloadKey, trimmedQuery]);

  const hasSearchResults =
    searchResults.posts.length > 0 ||
    searchResults.profiles.length > 0;

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
      <div className="sticky top-[var(--top-bar-height)] z-10 px-4 py-3 backdrop-blur-md lg:top-0" style={{ backgroundColor: 'color-mix(in srgb, var(--bg-primary) 80%, transparent)' }}>
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
        {TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className="flex-shrink-0 px-5 py-4 text-[15px] font-medium transition-colors hover:bg-[color:color-mix(in_srgb,var(--text-primary)_5%,transparent)]"
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

      {loading && <LoadingState label={isSearching ? 'Searching' : 'Loading trends'} />}
      {!loading && error && <ErrorState detail={error} onRetry={() => setReloadKey((key) => key + 1)} />}

      {!loading && !error && !isSearching && (
        <section className="mx-4 mt-4 overflow-hidden rounded-2xl border" style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-elevated)' }}>
          <h2 className="px-4 pb-2 pt-4 text-[20px] font-bold">Trending</h2>
          {trending.length === 0 && <EmptyState title="No trends yet" />}
          {trending.map((item, index) => (
            <button
              key={item.tag}
              type="button"
              className="w-full px-4 py-3 text-left transition-colors hover:bg-[color:color-mix(in_srgb,var(--text-primary)_5%,transparent)]"
              style={{ borderBottom: index < trending.length - 1 ? '1px solid var(--border-primary)' : undefined }}
            >
              <p className="mb-0.5 text-[13px]" style={{ color: 'var(--text-secondary)' }}>Trending</p>
              <p className="text-[15px] font-bold leading-tight">{item.tag}</p>
              <p className="mt-0.5 text-[13px]" style={{ color: 'var(--text-secondary)' }}>{formatCount(item.postCount)}</p>
            </button>
          ))}
        </section>
      )}

      {!loading && !error && isSearching && !hasSearchResults && (
        <EmptyState title="No results" detail={`No posts or people matched "${trimmedQuery}".`} />
      )}

      {!loading && !error && isSearching && hasSearchResults && (
        <div>
          {searchResults.profiles.length > 0 && (
            <SearchSection title="People">
              {searchResults.profiles.map((profile, index) => (
                <UserRow key={profile.id} user={profile} showBorder={index < searchResults.profiles.length - 1} />
              ))}
            </SearchSection>
          )}

          {searchResults.posts.length > 0 && (
            <section className="border-t" style={{ borderColor: 'var(--border-primary)' }}>
              <h2 className="px-4 pb-2 pt-4 text-[20px] font-bold">Posts</h2>
              {searchResults.posts.map((post) => (
                <PostCard
                  key={post.id}
                  post={post}
                  onLike={(id, liked, token) => void (liked ? likePost(token, id) : unlikePost(token, id))}
                  onRepost={(id, _reposted, token) => void repostPost(token, id)}
                  onBookmark={(id, bookmarked, token) => void (bookmarked ? bookmarkPost(token, id) : unbookmarkPost(token, id))}
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

function UserRow({ user, showBorder }: { user: { id: string; handle: string; displayName: string; avatarUrl: string | null; bio: string }; showBorder: boolean }) {
  return (
    <button
      type="button"
      className="flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-[color:color-mix(in_srgb,var(--text-primary)_3%,transparent)]"
      style={{ borderBottom: showBorder ? '1px solid var(--border-primary)' : undefined }}
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
      </div>
    </button>
  );
}

export default ExplorePage;
