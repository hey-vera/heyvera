import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { getTrending } from '../api/client';
import type { TrendingTopic } from '../api/types';
import { EmptyState, ErrorState, LoadingState } from '../components/shared/AsyncStates';

const TABS = ['For you', 'Trending', 'News', 'Tech', 'AI'] as const;
type Tab = typeof TABS[number];

function formatCount(count: number): string {
  if (count < 1000) return `${count} posts`;
  return `${(count / 1000).toFixed(count < 10000 ? 1 : 0).replace(/\.0$/, '')}K posts`;
}

export function ExplorePage() {
  const [activeTab, setActiveTab] = useState<Tab>('For you');
  const [trending, setTrending] = useState<TrendingTopic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function loadTrending() {
      setLoading(true);
      setError(null);
      try {
        const topics = await getTrending();
        if (!cancelled) setTrending(topics);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unable to load trends');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadTrending();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
      <div className="sticky top-0 z-10 bg-black/80 px-4 py-3 backdrop-blur-md">
        <div className="relative">
          <Search className="absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2" style={{ color: 'var(--text-secondary)' }} aria-hidden="true" />
          <input
            type="search"
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
            className="flex-shrink-0 px-5 py-4 text-[15px] font-medium transition-colors hover:bg-white/5"
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

      <section className="mx-4 mt-4 overflow-hidden rounded-2xl border" style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-elevated)' }}>
        <h2 className="px-4 pb-2 pt-4 text-[20px] font-bold">Trending</h2>
        {loading && <LoadingState label="Loading trends" />}
        {!loading && error && <ErrorState detail={error} onRetry={() => setReloadKey((key) => key + 1)} />}
        {!loading && !error && trending.length === 0 && <EmptyState title="No trends yet" />}
        {!loading && !error && trending.map((item, index) => (
          <button
            key={item.id}
            type="button"
            className="w-full px-4 py-3 text-left transition-colors hover:bg-white/5"
            style={{ borderBottom: index < trending.length - 1 ? '1px solid var(--border-primary)' : undefined }}
          >
            <p className="mb-0.5 text-[13px]" style={{ color: 'var(--text-secondary)' }}>{item.category}</p>
            <p className="text-[15px] font-bold leading-tight">{item.name}</p>
            <p className="mt-0.5 text-[13px]" style={{ color: 'var(--text-secondary)' }}>{formatCount(item.post_count)}</p>
          </button>
        ))}
      </section>
    </div>
  );
}

export default ExplorePage;
