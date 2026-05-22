import { useEffect, useState } from 'react';
import { getCommunities } from '../api/client';
import type { Community } from '../api/types';
import { EmptyState, ErrorState, LoadingState } from '../components/shared/AsyncStates';

const TABS = ['Your Communities', 'Discover'] as const;
type Tab = typeof TABS[number];

function formatMembers(count: number): string {
  if (count < 1000) return `${count} members`;
  return `${(count / 1000).toFixed(count < 10000 ? 1 : 0).replace(/\.0$/, '')}K members`;
}

export function CommunitiesPage() {
  const [activeTab, setActiveTab] = useState<Tab>('Your Communities');
  const [communities, setCommunities] = useState<Community[]>([]);
  const [joinedIds, setJoinedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function loadCommunities() {
      setLoading(true);
      setError(null);
      try {
        const items = await getCommunities();
        if (!cancelled) {
          setCommunities(items);
          setJoinedIds(new Set(items.filter((community) => community.is_member).map((community) => community.id)));
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unable to load communities');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadCommunities();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const visibleCommunities =
    activeTab === 'Your Communities'
      ? communities.filter((community) => joinedIds.has(community.id))
      : communities;

  const toggle = (id: string) => {
    setJoinedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
      <div className="sticky top-0 z-10 border-b bg-black/80 backdrop-blur-md" style={{ borderColor: 'var(--border-primary)' }}>
        <div className="px-4 py-3">
          <h1 className="text-[20px] font-bold">Communities</h1>
        </div>
        <div className="flex">
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
      </div>

      {loading && <LoadingState label="Loading communities" />}
      {!loading && error && <ErrorState detail={error} onRetry={() => setReloadKey((key) => key + 1)} />}
      {!loading && !error && visibleCommunities.length === 0 && (
        <EmptyState
          title={activeTab === 'Your Communities' ? 'No communities yet' : 'Nothing to discover yet'}
          detail={activeTab === 'Your Communities' ? 'Join communities from Discover and they will appear here.' : undefined}
        />
      )}
      {!loading && !error && visibleCommunities.length > 0 && (
        <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-2">
          {visibleCommunities.map((community) => {
            const joined = joinedIds.has(community.id);
            return (
              <article
                key={community.id}
                className="overflow-hidden rounded-2xl border"
                style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-elevated)' }}
              >
                {community.banner_url ? (
                  <img src={community.banner_url} alt="" className="h-24 w-full object-cover" />
                ) : (
                  <div className="h-24" style={{ backgroundColor: 'var(--border-primary)' }} />
                )}

                <div className="p-4">
                  <h3 className="text-[15px] font-bold leading-tight">{community.name}</h3>
                  <p className="mt-0.5 text-[13px]" style={{ color: 'var(--text-secondary)' }}>{formatMembers(community.member_count)}</p>
                  <p className="mt-2 text-[13px] leading-snug">{community.description}</p>

                  <button
                    type="button"
                    onClick={() => toggle(community.id)}
                    className="mt-3 rounded-full px-5 py-1.5 text-[14px] font-bold transition-all hover:opacity-90"
                    style={{
                      border: joined ? '1px solid var(--border-primary)' : undefined,
                      backgroundColor: joined ? 'transparent' : 'var(--accent)',
                      color: joined ? 'var(--text-primary)' : '#000',
                    }}
                  >
                    {joined ? 'Joined' : 'Join'}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default CommunitiesPage;
