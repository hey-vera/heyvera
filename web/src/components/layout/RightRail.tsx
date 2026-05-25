
interface TrendingItem {
  category: string;
  name: string;
  postCount: number;
}

interface SuggestedUser {
  name: string;
  handle: string;
  avatar: string;
}

interface RightRailProps {
  trending?: TrendingItem[];
  suggestions?: SuggestedUser[];
}

const defaultTrending: TrendingItem[] = [];

const defaultSuggestions: SuggestedUser[] = [];

function formatCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K posts`;
  return `${n} posts`;
}

export function RightRail({ trending = defaultTrending, suggestions = defaultSuggestions }: RightRailProps) {
  return (
    <aside
      className="hidden lg:flex flex-col gap-4 pt-2 pb-8 overflow-y-auto"
      style={{
        width: "var(--right-rail-width)",
        position: "sticky",
        top: 0,
        maxHeight: "100vh",
      }}
    >
      {/* Search bar */}
      <div className="px-4 pt-1">
        <div
          className="flex items-center gap-3 px-4 py-2.5 rounded-full"
          style={{ backgroundColor: "var(--bg-elevated)" }}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            style={{ color: "var(--text-secondary)", flexShrink: 0 }}
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="search"
            placeholder="Search"
            className="bg-transparent border-none outline-none w-full text-sm"
            style={{
              color: "var(--text-primary)",
              caretColor: "var(--accent)",
            }}
            aria-label="Search HeyVera"
          />
        </div>
      </div>

      {/* Subscribe to Premium */}
      <section
        className="mx-4 p-4 flex flex-col gap-3"
        style={{
          backgroundColor: "var(--bg-elevated)",
          borderRadius: "var(--card-radius)",
        }}
        aria-label="Subscribe to Premium"
      >
        <h2 className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>
          Subscribe to Premium
        </h2>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          Unlock exclusive features, longer posts, and support the platform.
        </p>
        <button
          className="self-start px-5 py-2 rounded-full text-sm font-bold transition-colors"
          style={{ backgroundColor: "var(--accent)", color: "#000" }}
          onMouseEnter={(e) =>
            ((e.currentTarget as HTMLButtonElement).style.backgroundColor = "var(--accent-hover)")
          }
          onMouseLeave={(e) =>
            ((e.currentTarget as HTMLButtonElement).style.backgroundColor = "var(--accent)")
          }
        >
          Subscribe
        </button>
      </section>

      {/* Trending */}
      <section
        className="mx-4 overflow-hidden"
        style={{
          backgroundColor: "var(--bg-elevated)",
          borderRadius: "var(--card-radius)",
        }}
        aria-label="Trending topics"
      >
        <h2
          className="text-lg font-bold px-4 pt-4 pb-2"
          style={{ color: "var(--text-primary)" }}
        >
          Trending
        </h2>

        {trending.length === 0 && (
          <p className="px-4 py-3 text-sm" style={{ color: "var(--text-secondary)" }}>
            No trends yet.
          </p>
        )}

        {trending.map((item, i) => (
          <button
            key={i}
            className="w-full flex flex-col items-start px-4 py-3 transition-colors hover:bg-white/5 text-left"
            aria-label={`Trending: ${item.name}`}
          >
            <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
              {item.category}
            </span>
            <span className="text-sm font-bold mt-0.5" style={{ color: "var(--text-primary)" }}>
              {item.name}
            </span>
            <span className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>
              {formatCount(item.postCount)}
            </span>
          </button>
        ))}

        {trending.length > 0 && (
          <button
            className="w-full text-left px-4 py-3 text-sm transition-colors hover:bg-white/5"
            style={{ color: "var(--accent)" }}
          >
            Show more
          </button>
        )}
      </section>

      {/* Who to follow */}
      <section
        className="mx-4 overflow-hidden"
        style={{
          backgroundColor: "var(--bg-elevated)",
          borderRadius: "var(--card-radius)",
        }}
        aria-label="Who to follow"
      >
        <h2
          className="text-lg font-bold px-4 pt-4 pb-2"
          style={{ color: "var(--text-primary)" }}
        >
          Who to follow
        </h2>

        {suggestions.length === 0 && (
          <p className="px-4 py-3 text-sm" style={{ color: "var(--text-secondary)" }}>
            No suggestions yet.
          </p>
        )}

        {suggestions.map((user, i) => (
          <div
            key={i}
            className="flex items-center gap-3 px-4 py-3 hover:bg-white/5 transition-colors"
          >
            {/* Avatar */}
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
              style={{ backgroundColor: "var(--bg-primary)", color: "var(--accent)" }}
              aria-hidden="true"
            >
              {user.avatar}
            </div>

            {/* Name + handle */}
            <div className="flex flex-col flex-1 min-w-0">
              <span
                className="text-sm font-bold leading-tight truncate"
                style={{ color: "var(--text-primary)" }}
              >
                {user.name}
              </span>
              <span
                className="text-sm leading-tight truncate"
                style={{ color: "var(--text-secondary)" }}
              >
                {user.handle}
              </span>
            </div>

            {/* Follow button */}
            <button
              className="flex-shrink-0 px-4 py-1.5 rounded-full text-sm font-bold border transition-colors hover:bg-white/10"
              style={{
                color: "var(--text-primary)",
                borderColor: "var(--border-primary)",
              }}
              aria-label={`Follow ${user.name}`}
            >
              Follow
            </button>
          </div>
        ))}

        {suggestions.length > 0 && (
          <button
            className="w-full text-left px-4 py-3 text-sm transition-colors hover:bg-white/5"
            style={{ color: "var(--accent)" }}
          >
            Show more
          </button>
        )}
      </section>

      {/* Footer links */}
      <footer className="px-4">
        <p className="text-xs leading-loose" style={{ color: "var(--text-tertiary)" }}>
          <a href="#" className="hover:underline">Terms</a>
          {" · "}
          <a href="#" className="hover:underline">Privacy</a>
          {" · "}
          <a href="#" className="hover:underline">Cookies</a>
          {" · "}
          <a href="#" className="hover:underline">About</a>
          {" · "}
          <a href="#" className="hover:underline">More...</a>
          <br />
          © 2026 HeyVera
        </p>
      </footer>
    </aside>
  );
}
