import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { useNavigate } from 'react-router';
import { fetchProfiles, fetchTrending } from '../../api/social';

interface TrendingItem {
  tag: string;
  postCount: number;
}

interface SuggestedUser {
  id: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
}

function formatCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}K posts`;
  return `${n} posts`;
}

export function RightRail() {
  const navigate = useNavigate();
  const [trending, setTrending] = useState<TrendingItem[]>([]);
  const [suggestions, setSuggestions] = useState<SuggestedUser[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    fetchTrending()
      .then((res) => setTrending(res.topics.slice(0, 5)))
      .catch(() => {});

    fetchProfiles(5)
      .then((res) =>
        setSuggestions(
          res.profiles.slice(0, 3).map((p) => ({
            id: p.id,
            handle: p.handle,
            displayName: p.displayName,
            avatarUrl: p.avatarUrl,
          })),
        ),
      )
      .catch(() => {});
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      navigate(`/explore?q=${encodeURIComponent(searchQuery.trim())}`);
    }
  };

  return (
    <aside
      className="hidden lg:flex flex-col gap-4 pt-2 pb-8 overflow-y-auto"
      style={{
        width: 'var(--right-rail-width)',
        position: 'sticky',
        top: 0,
        maxHeight: '100vh',
      }}
    >
      {/* Search bar */}
      <form className="px-4 pt-1" onSubmit={handleSearch}>
        <div
          className="flex items-center gap-3 px-4 py-2.5 rounded-full border transition-colors focus-within:border-[var(--accent)]"
          style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-primary)' }}
        >
          <Search size={18} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} aria-hidden="true" />
          <input
            type="search"
            placeholder="Search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="bg-transparent border-none outline-none w-full text-sm"
            style={{ color: 'var(--text-primary)', caretColor: 'var(--accent)' }}
            aria-label="Search HeyVera"
          />
        </div>
      </form>

      {/* Subscribe to Premium */}
      <section
        className="mx-4 p-4 flex flex-col gap-3"
        style={{ backgroundColor: 'var(--bg-elevated)', borderRadius: 'var(--card-radius)' }}
        aria-label="Subscribe to Premium"
      >
        <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
          Subscribe to Premium
        </h2>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          Unlock exclusive features, longer posts, and support the platform.
        </p>
        <button
          className="self-start px-5 py-2 rounded-full text-sm font-bold transition-opacity hover:opacity-90"
          style={{ backgroundColor: 'var(--accent)', color: '#000' }}
          onClick={() => navigate('/premium')}
        >
          Subscribe
        </button>
      </section>

      {/* Trending */}
      <section
        className="mx-4 overflow-hidden"
        style={{ backgroundColor: 'var(--bg-elevated)', borderRadius: 'var(--card-radius)' }}
        aria-label="Trending topics"
      >
        <h2 className="text-lg font-bold px-4 pt-4 pb-2" style={{ color: 'var(--text-primary)' }}>
          Trending
        </h2>

        {trending.length === 0 && (
          <p className="px-4 py-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
            No trends yet.
          </p>
        )}

        {trending.map((item, i) => {
          const tagLabel = item.tag.startsWith('#') ? item.tag : `#${item.tag}`;
          return (
          <button
            key={i}
            className="w-full flex flex-col items-start px-4 py-3 transition-colors hover-overlay text-left"
            aria-label={`Trending: ${tagLabel}`}
            onClick={() =>
              navigate(`/explore?q=${encodeURIComponent(tagLabel)}&filter=posts`)
            }
          >
            <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Trending</span>
            <span className="text-sm font-bold mt-0.5" style={{ color: 'var(--text-primary)' }}>
              {tagLabel}
            </span>
            <span className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
              {formatCount(item.postCount)}
            </span>
          </button>
          );
        })}

        {trending.length > 0 && (
          <button
            className="w-full text-left px-4 py-3 text-sm transition-colors hover-overlay"
            style={{ color: 'var(--accent)' }}
            onClick={() => navigate('/explore')}
          >
            Show more
          </button>
        )}
      </section>

      {/* Who to follow */}
      <section
        className="mx-4 overflow-hidden"
        style={{ backgroundColor: 'var(--bg-elevated)', borderRadius: 'var(--card-radius)' }}
        aria-label="Who to follow"
      >
        <h2 className="text-lg font-bold px-4 pt-4 pb-2" style={{ color: 'var(--text-primary)' }}>
          Who to follow
        </h2>

        {suggestions.length === 0 && (
          <p className="px-4 py-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
            No suggestions yet.
          </p>
        )}

        {suggestions.map((user) => (
          <button
            key={user.id}
            type="button"
            className="w-full flex items-center gap-3 px-4 py-3 hover-overlay transition-colors text-left"
            onClick={() => navigate(`/profile/${user.handle}`)}
          >
            {user.avatarUrl ? (
              <img
                src={user.avatarUrl}
                alt={user.displayName}
                className="w-10 h-10 rounded-full object-cover flex-shrink-0"
                style={{ backgroundColor: 'var(--border-primary)' }}
              />
            ) : (
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
                style={{ backgroundColor: 'var(--border-primary)', color: 'var(--text-secondary)' }}
                aria-hidden="true"
              >
                {user.displayName.charAt(0)}
              </div>
            )}
            <div className="flex flex-col flex-1 min-w-0">
              <span className="text-sm font-bold leading-tight truncate" style={{ color: 'var(--text-primary)' }}>
                {user.displayName}
              </span>
              <span className="text-sm leading-tight truncate" style={{ color: 'var(--text-secondary)' }}>
                @{user.handle}
              </span>
            </div>
          </button>
        ))}

        {suggestions.length > 0 && (
          <button
            className="w-full text-left px-4 py-3 text-sm transition-colors hover-overlay"
            style={{ color: 'var(--accent)' }}
            onClick={() => navigate('/explore')}
          >
            Show more
          </button>
        )}
      </section>

      {/* Footer links */}
      <footer className="px-4">
        <p className="text-xs leading-loose" style={{ color: 'var(--text-tertiary)' }}>
          <a href="/settings" className="hover:underline">Terms</a>
          {' · '}
          <a href="/settings" className="hover:underline">Privacy</a>
          {' · '}
          <a href="/settings" className="hover:underline">About</a>
          <br />
          &copy; 2026 HeyVera
        </p>
      </footer>
    </aside>
  );
}
